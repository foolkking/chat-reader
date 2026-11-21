package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"reflect"
	"strings"
)

const transitionName = "program-transition-v1.json"

// Optional independently signed sibling of the unchanged v1 manifest. It only
// certifies this *pair*, never every release with the same Alembic head.
type transition struct {
	Format         int               `json:"format"`
	Repository     string            `json:"repository"`
	RepoID         int64             `json:"repository_id"`
	FromVersion    string            `json:"from_version"`
	FromRevision   string            `json:"from_revision"`
	FromArchive    string            `json:"from_archive_sha256"`
	FromConfig     map[string]string `json:"from_config"`
	TargetManifest string            `json:"target_manifest_sha256"`
	Evidence       string            `json:"evidence_sha256"`
	Roles          []string          `json:"roles"`
}

type installedRole struct {
	Revision string `json:"revision"`
	Image    Image  `json:"image"`
}
type cutover struct {
	Mode     string   `json:"mode"`
	Reason   string   `json:"reason,omitempty"`
	Recovery string   `json:"recovery_at,omitempty"`
	Roles    []string `json:"roles,omitempty"`
}

func verifyTransition(c Config, r Release, manifest, raw, sig []byte) (*transition, error) {
	var t transition
	key, a := base64.StdEncoding.DecodeString(c.PublicKey)
	sign, b := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if a != nil || b != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, raw, sign) ||
		strict(raw, &t) != nil || t.Format != 1 || t.Repository != c.Repository || t.RepoID != c.RepoID ||
		!tagRE.MatchString(t.FromVersion) || !newer(r.Version, t.FromVersion) ||
		!shaRE.MatchString(t.FromRevision) || t.FromRevision == r.Revision || !hashRE.MatchString(t.FromArchive) ||
		t.TargetManifest != hash(manifest) || !hashRE.MatchString(t.Evidence) || len(t.FromConfig) != 2 ||
		!digest(t.FromConfig["web"]) || !digest(t.FromConfig["api"]) ||
		!(reflect.DeepEqual(t.Roles, []string{"api"}) || reflect.DeepEqual(t.Roles, []string{"web"}) ||
			reflect.DeepEqual(t.Roles, []string{"api", "web"})) {
		return nil, errors.New("invalid_transition")
	}
	return &t, nil
}
func qualifies(old, next Release) bool {
	t := next.Transition
	// A retained worker (or Web/API) is not necessarily the binary which was
	// exercised by the *next* release pair. Do not extrapolate a pair proof.
	for _, role := range []string{"web", "api", "import-worker"} {
		key := role
		if key == "import-worker" {
			key = "api"
		}
		if actual := roleImage(old, role); actual.Revision != old.Revision || !reflect.DeepEqual(actual.Image, old.Images[key]) {
			return false
		}
	}
	return t != nil && old.Repository == next.Repository && old.RepoID == next.RepoID &&
		reversible(old, next) && old.Version == t.FromVersion && old.Revision == t.FromRevision &&
		identity(old) == t.FromArchive && old.Images["api"].Config == t.FromConfig["api"] &&
		old.Images["web"].Config == t.FromConfig["web"]
}
func roleImage(r Release, role string) installedRole {
	if v, ok := r.Layout[role]; ok {
		return v
	}
	k := role
	if k == "import-worker" {
		k = "api"
	}
	return installedRole{r.Revision, r.Images[k]}
}
func programLayout(old, next Release, roles []string) Release {
	next.Layout = map[string]installedRole{}
	for _, k := range []string{"api", "web", "import-worker"} {
		from := old
		if contains(roles, k) {
			from = next
		}
		next.Layout[k] = roleImage(from, k)
	}
	return next
}
