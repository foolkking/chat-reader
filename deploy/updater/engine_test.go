package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testRelease(v, ch string) Release {
	id := "sha256:" + strings.Repeat(ch, 64)
	im := Image{Config: id, EngineIDs: []string{id}, Digest: id, RootFS: []string{id}}
	return Release{Format: 1, Version: v, Repository: "fixture/archive", RepoID: 12, Revision: strings.Repeat(ch, 40), Notes: "Synthetic", BuiltAt: "2026-11-18T00:00:00Z", Run: 1, Attempt: 1, Artifact: 2, ArtifactDigest: id, ArchiveSHA: strings.Repeat(ch, 64), Bytes: 3, Schema: "20261117_0062", From: []string{"20261117_0062"}, ABI: "local-assets-v1", JobABI: "reader-jobs-v1", MinUpdater: 1, Images: map[string]Image{"api": im, "web": im}}
}
func TestSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	r := testRelease("v2.0.0", "a")
	c := Config{Repository: r.Repository, RepoID: r.RepoID, PublicKey: base64.StdEncoding.EncodeToString(pub)}
	verify := func(r Release, bad bool) error {
		raw, _ := json.Marshal(r)
		sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, raw))
		if bad {
			raw = append(raw, ' ')
		}
		_, e := verified(c, "v2.0.0", raw, []byte(sig))
		return e
	}
	if verify(r, false) != nil || verify(r, true) == nil {
		t.Fatal("signature")
	}
	for _, mut := range []func(*Release){func(r *Release) { r.RepoID++ }, func(r *Release) { r.Repository = "fork/archive" }, func(r *Release) { r.MinUpdater++ }, func(r *Release) { r.ABI = "unknown" }, func(r *Release) { r.Images["api"] = Image{} }, func(r *Release) { r.From = nil }, func(r *Release) { r.Version = "v2.0.0-rc.1" }} {
		v := testRelease("v2.0.0", "a")
		mut(&v)
		if verify(v, false) == nil {
			t.Fatal("admitted incompatible manifest")
		}
	}
	if !newer("v2.10.0", "v2.2.0") || !newer("v2.0.0", "v2.0.0-rc.12") || newer("v2.0.0-rc.1", "v2.0.0") {
		t.Fatal("semver order")
	}
}

type fakeHost struct {
	fail    string
	called  []string
	restore bool
}

func (h *fakeHost) perform(op string, _, _ Release, _, _ string) (string, error) {
	h.called = append(h.called, op)
	if op == h.fail || (op == "restore-old" && !h.restore) {
		return "", errors.New("not verified")
	}
	return "", nil
}

type fakeSource struct {
	c   candidate
	bad bool
}

func (s fakeSource) check() (candidate, error) { return s.c, nil }
func (s fakeSource) download(candidate, string) error {
	if s.bad {
		return errors.New("broken transfer")
	}
	return nil
}
func fixture(t *testing.T) (*engine, *fakeHost, func()) {
	t.Helper()
	old := testRelease("v1.0.0", "a")
	c := candidate{testRelease("v1.1.0", "b"), 123}
	h := new(fakeHost)
	root := t.TempDir()
	if os.Mkdir(filepath.Join(root, "jobs"), 0700) != nil {
		t.Fatal("temp")
	}
	var async func()
	e := &engine{root: root, public: t.TempDir(), st: state{Current: old, Candidate: &c}, s: fakeSource{c, false}, h: h, launch: func(fn func()) { async = fn }}
	return e, h, func() { async() }
}
func accepted(t *testing.T, e *engine, action string, target Release, id string) intent {
	t.Helper()
	i := intent{ID: strings.Repeat(id, 32), Expected: identity(e.st.Current), Target: identity(target)}
	if _, x := e.ticket(i.ID); x != nil {
		t.Fatal(x)
	}
	if x := e.start(action, i); x != nil {
		t.Fatal(x)
	}
	return i
}
func TestJobTransitions(t *testing.T) {
	for _, tc := range []struct {
		op, want string
		restore  bool
	}{{"", "succeeded", false}, {"space", "refused", false}, {"stage", "refused", false}, {"backup", "restored", true}, {"migration", "recovery_required", false}, {"health", "restored", true}, {"health", "recovery_required", false}, {"commit", "recovery_required", true}} {
		t.Run(tc.op+"/"+tc.want, func(t *testing.T) {
			e, h, run := fixture(t)
			h.fail = tc.op
			h.restore = tc.restore
			old := e.st.Current
			target := e.st.Candidate.Release
			i := accepted(t, e, "prepare", target, "a")
			run()
			if tc.op == "space" || tc.op == "stage" {
				if e.st.Job.Phase != "refused" || contains(h.called, "fencing") {
					t.Fatal("unsafe preparation")
				}
				return
			}
			if !e.view().Prepared || e.st.Job.Phase != "prepared" || contains(h.called, "fencing") {
				t.Fatal("not prepared online")
			}
			h.called = nil
			i = accepted(t, e, "apply", target, "c")
			if x := e.start("apply", i); x != nil {
				t.Fatal("not idempotent")
			}
			other := i
			other.ID = strings.Repeat("b", 32)
			if e.start("apply", other) == nil {
				t.Fatal("concurrent admission")
			}
			run()
			if contains(h.called, "stage") || contains(h.called, "space") {
				t.Fatal("repeated stage after confirmation")
			}
			if e.st.Job.Phase != tc.want {
				t.Fatal(e.st.Job.Phase)
			}
			if tc.want == "refused" && contains(h.called, "fencing") {
				t.Fatal("stopped live service before admission")
			}
			if tc.want == "succeeded" {
				accepted(t, e, "rollback", old, "b")
				run()
				if e.st.Job.Phase != "succeeded" || e.st.Current.Revision != old.Revision {
					t.Fatal("rollback")
				}
			}
		})
	}
}
func TestRefusalsAndCrash(t *testing.T) {
	e, h, run := fixture(t)
	target := e.st.Candidate.Release
	_, _ = e.ticket(strings.Repeat("a", 32))
	if e.start("apply", intent{ID: strings.Repeat("a", 32), Expected: "stale", Target: identity(target)}) == nil {
		t.Fatal("stale")
	}
	e.s = fakeSource{*e.st.Candidate, true}
	accepted(t, e, "prepare", target, "a")
	run()
	if e.st.Job.Phase != "refused" || contains(h.called, "fencing") {
		t.Fatal("bad download")
	}
	target.Schema = "20261118_0063"
	e.st.Previous = &target
	if e.start("rollback", intent{ID: strings.Repeat("f", 32), Expected: identity(e.st.Current), Target: identity(target)}) == nil {
		t.Fatal("cross-schema rollback")
	}
	e.st.Job.Phase = "migration"
	h.called = nil
	if e.reconcile() != nil || e.st.Job.Phase != "recovery_required" || contains(h.called, "migration") {
		t.Fatal("blind migration replay")
	}
}
func TestPreparedIdentityAndLocalRestart(t *testing.T) {
	e, h, run := fixture(t)
	r := e.st.Candidate.Release
	id := strings.Repeat("d", 32)
	e.ticket(id)
	i := intent{ID: id, Expected: identity(e.st.Current), Target: identity(r)}
	if e.start("apply", i) == nil {
		t.Fatal("unprepared restart")
	}
	accepted(t, e, "prepare", r, "a")
	run()
	e.s = fakeSource{} // No network access needed once staged.
	exp := e.st.Prepared.Expires
	e.st.Prepared.Expires = 1
	if e.start("apply", i) == nil {
		t.Fatal("expired staging")
	}
	e.st.Prepared.Expires = exp
	e.st.Candidate.Asset++
	if e.start("apply", i) == nil {
		t.Fatal("retargeted staging")
	}
	e.st.Candidate.Asset--
	accepted(t, e, "apply", r, "d")
	run()
	if e.st.Job.Phase != "succeeded" || !contains(h.called, "restart-preflight") {
		t.Fatal("local confirmed cutover")
	}
}
func TestMonitor(t *testing.T) {
	e, _, _ := fixture(t)
	id := strings.Repeat("a", 32)
	token, x := e.ticket(id)
	if x != nil {
		t.Fatal(x)
	}
	for _, tc := range []struct {
		method, path, val string
		code              int
	}{{"GET", monitorPath, token, 200}, {"POST", monitorPath, token, 404}, {"GET", monitorPath + "?token=" + token, token, 404}, {"GET", monitorPath, "", 404}, {"GET", monitorPath + "status", "wrong", 404}, {"GET", "/apply", token, 404}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.AddCookie(&http.Cookie{Name: cookieName, Value: tc.val})
		progress(e.public)(w, r)
		if w.Code != tc.code || strings.Contains(w.Body.String(), token) {
			t.Fatal(tc.method, w.Code)
		}
	}
	atomic(filepath.Join(e.public, "ticket.json"), grant{id, hash([]byte(token)), time.Now().Unix() - 1}, 0600)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", monitorPath, nil)
	r.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	progress(e.public)(w, r)
	if w.Code != 404 {
		t.Fatal("expired ticket")
	}
}
func TestDownloadIntegrity(t *testing.T) {
	r := testRelease("v1.0.0", "a")
	r.ArchiveSHA = hash([]byte("abc"))
	for _, body := range []string{"abc", "abcd", "ab", "xyz"} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if req.URL.Path != "/repos/fixture/archive/releases/assets/9" || req.Header.Get("Authorization") != "Bearer test-read-only" {
				t.Error("source binding")
			}
			w.Write([]byte(body))
		}))
		s := newSource(Config{RepoID: 12, Repository: "fixture/archive"}, "test-read-only")
		s.base = srv.URL
		err := s.download(candidate{r, 9}, filepath.Join(t.TempDir(), "archive"))
		srv.Close()
		if (err == nil) != (body == "abc") {
			t.Fatal("size/digest not enforced")
		}
	}
}
