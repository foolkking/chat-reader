package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const protocol = 1
const archiveName = "chat-reader-images.tar.gz"
const manifestName = "update-v1.json"

var tagRE = regexp.MustCompile(`^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:-rc\.([1-9][0-9]{0,8}))?$`)
var shaRE = regexp.MustCompile(`^[a-f0-9]{40}$`)
var hashRE = regexp.MustCompile(`^[a-f0-9]{64}$`)
var repoRE = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]*/[a-zA-Z0-9][a-zA-Z0-9._-]*$`)
var schemaRE = regexp.MustCompile(`^[0-9]{8}_[0-9]{4}$`)

type Config struct {
	Repository string `json:"repository"`
	RepoID     int64  `json:"repository_id"`
	PublicKey  string `json:"public_key"`
	Channel    string `json:"channel"`
	CommandGID int    `json:"command_gid"`
	CommandUID int    `json:"command_uid"`
	StatusGID  int    `json:"status_gid"`
}
type Image struct {
	Config    string   `json:"config"`
	EngineIDs []string `json:"engine_ids"`
	RootFS    []string `json:"rootfs"`
	Digest    string   `json:"registry_digest"`
}
type Release struct {
	Format         int              `json:"format"`
	Version        string           `json:"version"`
	Repository     string           `json:"repository"`
	RepoID         int64            `json:"repository_id"`
	Revision       string           `json:"revision"`
	Notes          string           `json:"notes"`
	BuiltAt        string           `json:"built_at"`
	Run            int64            `json:"run_id"`
	Attempt        int              `json:"attempt"`
	Artifact       int64            `json:"artifact_id"`
	ArtifactDigest string           `json:"artifact_digest"`
	ArchiveSHA     string           `json:"archive_sha256"`
	Bytes          int64            `json:"archive_bytes"`
	Images         map[string]Image `json:"images"`
	Schema         string           `json:"schema"`
	From           []string         `json:"from_schemas"`
	ABI            string           `json:"provider_abi"`
	JobABI         string           `json:"job_abi"`
	MinUpdater     int              `json:"min_updater"`
}

func strict(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing data")
	}
	return nil
}
func digest(s string) bool { return strings.HasPrefix(s, "sha256:") && hashRE.MatchString(s[7:]) }
func contains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}
func (c Config) valid() bool {
	k, e := base64.StdEncoding.DecodeString(c.PublicKey)
	return e == nil && len(k) == 32 && repoRE.MatchString(c.Repository) && c.RepoID > 0 && (c.Channel == "stable" || c.Channel == "preview") && c.CommandUID > 0 && c.CommandGID > 0 && c.StatusGID > 0 && c.CommandGID != c.StatusGID
}
func verified(c Config, tag string, raw, sig []byte) (Release, error) {
	var r Release
	key, e := base64.StdEncoding.DecodeString(c.PublicKey)
	s, se := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if e != nil || se != nil || len(key) != 32 || !ed25519.Verify(key, raw, s) || strict(raw, &r) != nil {
		return r, errors.New("signature_or_manifest")
	}
	if r.Repository != c.Repository || r.RepoID != c.RepoID || r.Version != tag || !tagRE.MatchString(tag) || r.Format != 1 || !shaRE.MatchString(r.Revision) || !hashRE.MatchString(r.ArchiveSHA) || r.Bytes <= 0 || r.Bytes > 8<<30 || r.Run < 1 || r.Attempt < 1 || r.Artifact < 1 || !digest(r.ArtifactDigest) || !schemaRE.MatchString(r.Schema) || r.MinUpdater < 1 || r.MinUpdater > protocol || len(r.Notes) > 24000 || len(r.Images) != 2 || len(r.From) == 0 || len(r.From) > 128 || r.ABI != "local-assets-v1" || r.JobABI != "reader-jobs-v1" {
		return r, errors.New("incompatible_manifest")
	}
	if _, e = time.Parse(time.RFC3339, r.BuiltAt); e != nil {
		return r, errors.New("build_time")
	}
	for _, v := range r.From {
		if !schemaRE.MatchString(v) {
			return r, errors.New("invalid_schema")
		}
	}
	for _, role := range []string{"api", "web"} {
		i := r.Images[role]
		if !digest(i.Config) || !contains(i.EngineIDs, i.Config) || len(i.EngineIDs) > 4 || !digest(i.Digest) || len(i.RootFS) == 0 || len(i.RootFS) > 128 {
			return r, errors.New("invalid_images")
		}
		for _, l := range append(append([]string{}, i.RootFS...), i.EngineIDs...) {
			if !digest(l) {
				return r, errors.New("invalid_images")
			}
		}
	}
	return r, nil
}
func version(s string) [4]int {
	var v [4]int
	m := tagRE.FindStringSubmatch(s)
	if m == nil {
		return v
	}
	for i := range v {
		if i == 3 && m[4] == "" {
			v[i] = 1 << 30
		} else {
			v[i], _ = strconv.Atoi(m[i+1])
		}
	}
	return v
}
func newer(a, b string) bool {
	if !tagRE.MatchString(a) {
		return false
	}
	if b == "legacy" {
		return true
	}
	x, y := version(a), version(b)
	for i := range x {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return false
}

type asset struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}
type githubRelease struct {
	Tag    string  `json:"tag_name"`
	Draft  bool    `json:"draft"`
	Pre    bool    `json:"prerelease"`
	Assets []asset `json:"assets"`
}
type source struct {
	c      Config
	client *http.Client
	token  string
	base   string
}

func newSource(c Config, token string) *source {
	return &source{c: c, base: "https://api.github.com", token: token, client: &http.Client{Timeout: 30 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 4 || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Port() != "" {
			return errors.New("unexpected redirect")
		}
		host := req.URL.Hostname()
		if host != "api.github.com" && host != "release-assets.githubusercontent.com" && host != "objects.githubusercontent.com" {
			return errors.New("unexpected host")
		}
		if host != "api.github.com" {
			req.Header.Del("Authorization")
		}
		return nil
	}}}
}
func (s *source) get(path, accept string) (io.ReadCloser, error) {
	req, e := http.NewRequest("GET", s.base+path, nil)
	if e != nil {
		return nil, errors.New("source_request")
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, e := s.client.Do(req)
	if e != nil {
		return nil, errors.New("source_unavailable")
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, errors.New("source_denied_or_unavailable")
	}
	return resp.Body, nil
}
func (s *source) read(path, accept string, limit int64) ([]byte, error) {
	r, e := s.get(path, accept)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	b, e := io.ReadAll(io.LimitReader(r, limit+1))
	if e != nil || int64(len(b)) > limit {
		return nil, errors.New("source_response_size")
	}
	return b, nil
}
func (s *source) asset(id int64) string {
	return fmt.Sprintf("/repos/%s/releases/assets/%d", s.c.Repository, id)
}

type candidate struct {
	Release Release
	Asset   int64
}

func (s *source) check() (candidate, error) {
	var result candidate
	path := "/repos/" + s.c.Repository
	b, e := s.read(path, "application/vnd.github+json", 128<<10)
	if e != nil {
		return result, e
	}
	var id struct {
		ID   int64  `json:"id"`
		Name string `json:"full_name"`
	}
	if json.Unmarshal(b, &id) != nil || id.ID != s.c.RepoID || id.Name != s.c.Repository {
		return result, errors.New("repository_identity")
	}
	var best githubRelease
	for page := 1; page <= 20; page++ {
		b, e = s.read(fmt.Sprintf("%s/releases?per_page=100&page=%d", path, page), "application/vnd.github+json", 8<<20)
		if e != nil {
			return result, e
		}
		var rs []githubRelease
		if json.Unmarshal(b, &rs) != nil {
			return result, errors.New("release_list")
		}
		for _, r := range rs {
			if r.Draft || !tagRE.MatchString(r.Tag) || r.Pre != strings.Contains(r.Tag, "-rc.") || (s.c.Channel == "stable" && r.Pre) {
				continue
			}
			if best.Tag == "" || newer(r.Tag, best.Tag) {
				best = r
			}
		}
		if len(rs) < 100 {
			break
		}
		if page == 20 {
			return result, errors.New("release_list_limit")
		}
	}
	if best.Tag == "" {
		return result, nil
	}
	files := map[string]asset{}
	for _, a := range best.Assets {
		if a.Name == manifestName || a.Name == manifestName+".sig" || a.Name == archiveName {
			if _, ok := files[a.Name]; ok || a.ID < 1 {
				return result, errors.New("release_assets")
			}
			files[a.Name] = a
		}
	}
	if len(files) != 3 {
		return result, errors.New("incomplete_release")
	}
	raw, e := s.read(s.asset(files[manifestName].ID), "application/octet-stream", 128<<10)
	if e != nil {
		return result, e
	}
	sig, e := s.read(s.asset(files[manifestName+".sig"].ID), "application/octet-stream", 512)
	if e != nil {
		return result, e
	}
	r, e := verified(s.c, best.Tag, raw, sig)
	if e != nil || r.Bytes != files[archiveName].Size {
		return result, errors.New("release_verification")
	}
	return candidate{r, files[archiveName].ID}, nil
}
func (s *source) download(c candidate, path string) error {
	r, e := s.get(s.asset(c.Asset), "application/octet-stream")
	if e != nil {
		return e
	}
	defer r.Close()
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(f, h), io.LimitReader(r, c.Release.Bytes+1))
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil || ce != nil || n != c.Release.Bytes || hex.EncodeToString(h.Sum(nil)) != c.Release.ArchiveSHA {
		return errors.New("archive_verification")
	}
	return nil
}
