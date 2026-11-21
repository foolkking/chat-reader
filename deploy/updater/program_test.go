package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func pair(a, b Release) *transition {
	return &transition{1, b.Repository, b.RepoID, a.Version, a.Revision, a.ArchiveSHA,
		map[string]string{"api": a.Images["api"].Config, "web": a.Images["web"].Config},
		hash([]byte("raw")), strings.Repeat("f", 64), []string{"web"}}
}

func TestSignedPairAndPrivateRuntimeFields(t *testing.T) {
	a, b := testRelease("v1.0.0", "a"), testRelease("v1.1.0", "b")
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	c := Config{Repository: b.Repository, RepoID: b.RepoID, PublicKey: base64.StdEncoding.EncodeToString(pub)}
	sign := func(raw []byte) []byte { return []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, raw))) }
	tr := pair(a, b)
	for _, mutation := range []string{"valid", "foreign", "bad-source", "manifest", "worker", "signature"} {
		x := *tr
		switch mutation {
		case "foreign":
			x.RepoID++
		case "bad-source":
			x.FromVersion = b.Version
		case "manifest":
			x.TargetManifest = hash(nil)
		case "worker":
			x.Roles = []string{"import-worker"}
		}
		raw, _ := json.Marshal(x)
		sig := sign(raw)
		if mutation == "signature" {
			raw = append(raw, ' ')
		}
		_, err := verifyTransition(c, b, []byte("raw"), raw, sig)
		if (err == nil) != (mutation == "valid") {
			t.Fatal(mutation)
		}
	}
	raw, _ := json.Marshal(b)
	for _, k := range []string{"installed_roles", "transition"} {
		for _, v := range []string{"null", "{}"} {
			in := []byte(strings.TrimSuffix(string(raw), "}") + `,"` + k + `":` + v + `}`)
			if _, err := verified(c, b.Version, in, sign(in)); err == nil {
				t.Fatal("remote journal override", k, v)
			}
		}
	}
}

type programHost struct {
	fail  string
	calls []string
}

func (h *programHost) perform(op string, _, next Release, _, _ string) (string, error) {
	h.calls = append(h.calls, op)
	if op == h.fail {
		return "", errors.New("synthetic fault")
	}
	if op == "classify-program" {
		raw, _ := json.Marshal(cutover{Mode: "program", Roles: next.Transition.Roles, Recovery: "2026-11-18T03:00:00Z"})
		return string(raw), nil
	}
	return "", nil
}

func TestProgramChangesOnlyProvenRolesAndRequiresTheDisplayedPreparation(t *testing.T) {
	for _, roles := range [][]string{{"web"}, {"api"}, {"api", "web"}} {
		for _, fail := range []string{"", "program-preflight", "program-health", "program-commit"} {
			e, _, run := fixture(t)
			old := e.st.Current
			c := *e.st.Candidate
			c.Release.Transition = pair(old, c.Release)
			c.Release.Transition.Roles = roles
			e.st.Candidate = &c
			e.s = fakeSource{c, false}
			h := &programHost{}
			e.h = h
			accepted(t, e, "prepare", c.Release, "a")
			run()
			v := e.view()
			if !v.Prepared || v.Plan == nil || v.Plan.Mode != "program" {
				t.Fatal("did not prepare", e.st.Job)
			}
			i := intent{ID: strings.Repeat("b", 32), Expected: identity(old), Target: identity(c.Release)}
			e.ticket(i.ID)
			if e.start("apply", i) == nil {
				t.Fatal("unbound confirmation")
			}
			i.Preparation = strings.Repeat("c", 32)
			if e.start("apply", i) == nil {
				t.Fatal("stale preparation")
			}
			i.Preparation = v.Preparation
			h.calls = nil
			h.fail = fail
			if err := e.start("apply", i); err != nil {
				t.Fatal(err)
			}
			if err := e.start("apply", i); err != nil {
				t.Fatal(err)
			}
			run()
			for _, op := range []string{"fencing", "backup", "migration", "draining", "restore-old", "restart-preflight", "stage", "space"} {
				if contains(h.calls, op) {
					t.Fatal("silently switched maintenance mode", op)
				}
			}
			result := map[string]string{"": "succeeded", "program-preflight": "refused", "program-health": "restored", "program-commit": "recovery_required"}[fail]
			if e.st.Job.Phase != result {
				t.Fatal(e.st.Job.Phase)
			}
			if fail != "" {
				if e.st.Current.Revision != old.Revision {
					t.Fatal("incorrect pointer")
				}
				continue
			}
			for _, r := range []string{"web", "api", "import-worker"} {
				want := old.Revision
				if contains(roles, r) {
					want = c.Release.Revision
				}
				if roleImage(e.st.Current, r).Revision != want {
					t.Fatal("false image attribution", r)
				}
			}
			forward := e.st.Current
			future := testRelease("v1.2.0", "d")
			future.Transition = pair(c.Release, future)
			if qualifies(forward, future) {
				t.Fatal("mixed-role baseline falsely certified")
			}
			accepted(t, e, "rollback", old, "d")
			run()
			if e.st.Job.Phase != "succeeded" || !reflect.DeepEqual(e.st.Current, old) {
				t.Fatal("did not return to old programs")
			}
			// Durable state also authenticates the reverse direction after restart.
			if e.view().RollbackPlan == nil {
				t.Fatal("program rollback lost")
			}
		}
	}
}

func TestProgramCrashNeverReplaysTheSwitch(t *testing.T) {
	for _, stage := range []string{"program-switch", "program-health", "program-commit"} {
		e, _, _ := fixture(t)
		old, next := e.st.Current, e.st.Candidate.Release
		id := strings.Repeat("9", 32)
		dir := filepath.Join(e.root, "jobs", id)
		if os.Mkdir(dir, 0700) != nil {
			t.Fatal("temp")
		}
		j := programJournal{old, next, cutover{Mode: "program", Roles: []string{"web"}}, strings.Repeat("a", 32), false}
		if atomic(filepath.Join(dir, "program.json"), j, 0600) != nil {
			t.Fatal("journal")
		}
		e.st.Job = &job{ID: id, Phase: stage, Expected: identity(old), Target: identity(next)}
		h := &programHost{}
		e.h = h
		if e.reconcile() != nil || contains(h.calls, "program-switch") || contains(h.calls, "migration") {
			t.Fatal("replayed mutating step")
		}
		if stage == "program-commit" && e.st.Job.Phase != "succeeded" || stage != "program-commit" && e.st.Job.Phase != "restored" {
			t.Fatal("unverified state", stage)
		}
	}
}
