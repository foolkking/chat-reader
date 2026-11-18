package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sync"
	"time"
)

const stateRoot = "/var/lib/chat-reader-updater"
const publicRoot = "/var/lib/chat-reader-update-progress"
const etc = "/etc/chat-reader/updater"
const helper = "/usr/local/lib/chat-reader-updater/host.py"

type job struct {
	ID        string           `json:"id"`
	Action    string           `json:"action"`
	Phase     string           `json:"phase"`
	Reason    string           `json:"reason,omitempty"`
	Expected  string           `json:"expected"`
	Target    string           `json:"target"`
	Updated   int64            `json:"updated"`
	StartedMS int64            `json:"started_ms,omitempty"`
	PhaseMS   int64            `json:"phase_ms,omitempty"`
	Times     map[string]int64 `json:"timings_ms,omitempty"`
}

// Bound to the full signed manifest and immutable asset, the incumbent program and
// the enrolled host. Preparing a version never authorizes the subsequent restart.
type staged struct {
	Candidate                    candidate
	JobID                        string
	From, Fingerprint            string
	Expires, DownloadMS, ReadyMS int64
}
type state struct {
	Current     Release
	Previous    *Release
	Fingerprint string
	Candidate   *candidate
	Prepared    *staged
	Job         *job
	Used        []string
}
type intent struct {
	Expected string `json:"expected"`
	Target   string `json:"target"`
	ID       string `json:"id"`
}
type grant struct {
	ID, Hash string
	Expires  int64
}
type view struct {
	Source     string `json:"source"`
	Channel    string `json:"channel"`
	Current    string `json:"current"`
	Revision   string `json:"revision"`
	Target     string `json:"target,omitempty"`
	TargetID   string `json:"target_id,omitempty"`
	Notes      string `json:"notes,omitempty"`
	Previous   string `json:"previous,omitempty"`
	PreviousID string `json:"previous_id,omitempty"`
	Blocked    string `json:"blocked,omitempty"`
	Bytes      int64  `json:"archive_bytes,omitempty"`
	Prepared   bool   `json:"prepared,omitempty"`
	DownloadMS int64  `json:"download_ms,omitempty"`
	ReadyMS    int64  `json:"ready_ms,omitempty"`
	Job        *job   `json:"job,omitempty"`
}
type deployHost interface {
	perform(string, Release, Release, string, string) (string, error)
}
type originSource interface {
	check() (candidate, error)
	download(candidate, string) error
}
type engine struct {
	mu           sync.Mutex
	c            Config
	root, public string
	st           state
	h            deployHost
	s            originSource
	launch       func(func())
	checkMu      sync.Mutex
}

var idRE = regexp.MustCompile(`^[a-f0-9]{32}$`)

func hash(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func nonce() (string, error) {
	b := make([]byte, 32)
	_, e := rand.Read(b)
	return hex.EncodeToString(b), e
}
func atomic(path string, v any, mode os.FileMode) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	return atomicBytes(path, b, mode)
}
func atomicBytes(path string, b []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	f, e := os.CreateTemp(dir, ".pending-")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(mode); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return e
	}
	if ce != nil {
		return ce
	}
	if e = os.Rename(name, path); e != nil {
		return e
	}
	// The shipping daemon is Linux-only. Windows does not support fsync on a directory handle.
	if runtime.GOOS == "windows" {
		return nil
	}
	d, e := os.Open(dir)
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func readJSON(path string, v any) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return strict(b, v)
}
func active(j *job) bool {
	return j != nil && !contains([]string{"prepared", "succeeded", "refused", "restored", "recovery_required"}, j.Phase)
}
func blocked(j *job) bool { return active(j) || (j != nil && j.Phase == "recovery_required") }
func eligible(old, next Release) bool {
	return old.JobABI == next.JobABI && old.ABI == next.ABI && contains(next.From, old.Schema)
}

// V1 never downgrades a database; a tested same-schema/job/provider contract is required.
func reversible(old, next Release) bool {
	return old.Schema == next.Schema && old.ABI == next.ABI && old.JobABI == next.JobABI
}
func identity(r Release) string {
	if r.Version == "legacy" {
		return r.Revision
	}
	return r.ArchiveSHA
}
func (e *engine) save() error { return atomic(filepath.Join(e.root, "state.json"), e.st, 0600) }
func (e *engine) projection() error {
	if e.st.Job == nil {
		return nil
	}
	j := e.st.Job
	return atomic(filepath.Join(e.public, "progress.json"), j, 0640)
}
func (e *engine) phase(p, reason string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.phaseLocked(p, reason)
}
func (e *engine) phaseLocked(p, reason string) error {
	j := e.st.Job
	now := time.Now()
	if j.Times == nil {
		j.Times = map[string]int64{}
	}
	if j.PhaseMS != 0 {
		j.Times[j.Phase] += max(int64(0), now.UnixMilli()-j.PhaseMS)
	}
	j.Phase, j.Reason, j.Updated, j.PhaseMS = p, reason, now.Unix(), now.UnixMilli()
	if x := e.save(); x != nil {
		return x
	}
	if !active(j) {
		if err := atomic(filepath.Join(e.root, "jobs", j.ID, "result.json"), j, 0600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return e.projection()
}
func (s *state) ready() bool {
	p := s.Prepared
	return p != nil && idRE.MatchString(p.JobID) && s.Candidate != nil && p.Expires > time.Now().Unix() && p.From == identity(s.Current) &&
		p.Fingerprint == s.Fingerprint && reflect.DeepEqual(*s.Candidate, p.Candidate)
}
func (e *engine) view() view {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.st
	v := view{Source: e.c.Repository, Channel: e.c.Channel, Current: s.Current.Version, Revision: identity(s.Current)}
	if s.Job != nil {
		j := *s.Job
		j.Times = map[string]int64{}
		for k, v := range s.Job.Times {
			j.Times[k] = v
		}
		v.Job = &j
	}
	if s.Candidate != nil && newer(s.Candidate.Release.Version, s.Current.Version) {
		r := s.Candidate.Release
		v.Target = r.Version
		v.TargetID = identity(r)
		v.Notes = r.Notes
		v.Bytes = r.Bytes
		v.Prepared = s.ready()
		if v.Prepared {
			v.DownloadMS = s.Prepared.DownloadMS
			v.ReadyMS = s.Prepared.ReadyMS
		}
		if !eligible(s.Current, r) {
			v.Blocked = "incompatible_release"
		}
	}
	if s.Previous != nil && reversible(s.Current, *s.Previous) {
		v.Previous = s.Previous.Version
		v.PreviousID = identity(*s.Previous)
	}
	return v
}
func (e *engine) check() error {
	if !e.checkMu.TryLock() {
		return errors.New("busy")
	}
	defer e.checkMu.Unlock()
	e.mu.Lock()
	if blocked(e.st.Job) {
		e.mu.Unlock()
		return errors.New("busy")
	}
	baseline := identity(e.st.Current)
	e.st.Candidate = nil
	err := e.save()
	e.mu.Unlock()
	if err != nil {
		return err
	}
	c, err := e.s.check()
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if blocked(e.st.Job) || baseline != identity(e.st.Current) {
		return errors.New("stale")
	}
	if c.Asset > 0 {
		e.st.Candidate = &c
	}
	return e.save()
}
func (e *engine) ticket(id string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !idRE.MatchString(id) || (blocked(e.st.Job) && id != e.st.Job.ID) {
		return "", errors.New("busy")
	}
	t, x := nonce()
	if x != nil {
		return "", x
	}
	return t, atomic(filepath.Join(e.public, "ticket.json"), grant{id, hash([]byte(t)), time.Now().Add(90 * time.Minute).Unix()}, 0640)
}
func (e *engine) start(action string, i intent) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := &e.st
	if !idRE.MatchString(i.ID) {
		return errors.New("invalid_request")
	}
	if j := s.Job; j != nil && j.ID == i.ID {
		if j.Action == action && j.Expected == i.Expected && j.Target == i.Target {
			return nil
		}
		return errors.New("stale")
	}
	if blocked(s.Job) || contains(s.Used, i.ID) || i.Expected != identity(s.Current) {
		return errors.New("stale")
	}
	var c candidate
	switch action {
	case "prepare", "apply":
		if s.Candidate == nil || !newer(s.Candidate.Release.Version, s.Current.Version) || !eligible(s.Current, s.Candidate.Release) {
			return errors.New("incompatible_release")
		}
		c = *s.Candidate
		if (action == "apply") != s.ready() {
			return errors.New("preparation_required_or_already_ready")
		}
	case "rollback":
		if s.Previous == nil || !reversible(s.Current, *s.Previous) {
			return errors.New("unsafe_rollback")
		}
		c.Release = *s.Previous
	default:
		return errors.New("invalid_request")
	}
	if identity(c.Release) != i.Target || c.Release.Revision == s.Current.Revision {
		return errors.New("stale")
	}
	var g grant
	if readJSON(filepath.Join(e.public, "ticket.json"), &g) != nil || g.ID != i.ID || g.Expires <= time.Now().Unix() {
		return errors.New("monitor_required")
	}
	now := time.Now()
	s.Job = &job{ID: i.ID, Action: action, Phase: "admission", Expected: i.Expected, Target: i.Target, Updated: now.Unix(), StartedMS: now.UnixMilli(), PhaseMS: now.UnixMilli()}
	s.Used = append(s.Used, i.ID)
	if len(s.Used) > 128 {
		s.Used = s.Used[len(s.Used)-128:]
	}
	if x := e.save(); x != nil {
		return x
	}
	if x := e.projection(); x != nil {
		return x
	}
	old, fp := s.Current, s.Fingerprint
	preparedID := ""
	if action == "apply" {
		preparedID = s.Prepared.JobID
	}
	e.launch(func() { e.run(i.ID, old, c, fp, action, preparedID) })
	return nil
}
func (e *engine) run(id string, old Release, c candidate, fp, action, preparedID string) {
	next := c.Release
	dir := filepath.Join(e.root, "jobs", id)
	if os.Mkdir(dir, 0700) != nil {
		e.phase("refused", "job_storage")
		return
	}
	call := func(op string) error { _, x := e.h.perform(op, old, next, fp, dir); return x }
	if action == "prepare" {
		if call("admit") != nil {
			e.phase("refused", "configuration_or_runtime")
			return
		}
		fresh, x := e.s.check()
		if x != nil || !reflect.DeepEqual(fresh, c) {
			e.phase("refused", "source_changed")
			return
		}
		if call("space") != nil {
			e.phase("refused", "insufficient_space")
			return
		}
		if e.phase("downloading", "") != nil {
			return
		}
		if e.s.download(c, filepath.Join(dir, archiveName)) != nil {
			e.phase("refused", "download_verification")
			return
		}
		if e.phase("staging", "") != nil {
			return
		}
		if call("stage") != nil {
			e.phase("refused", "capacity_or_images")
			return
		}
		// Only delete our own successful transport spool. The exact images are
		// retained by Docker; this is never a backup, journal, or operator file.
		if err := os.Remove(filepath.Join(dir, archiveName)); err != nil && !os.IsNotExist(err) {
			e.phase("refused", "job_storage")
			return
		}
		e.mu.Lock()
		e.st.Prepared = &staged{Candidate: c, JobID: id, From: identity(old), Fingerprint: fp, Expires: time.Now().Add(30 * time.Minute).Unix(), DownloadMS: e.st.Job.Times["downloading"], ReadyMS: time.Now().UnixMilli() - e.st.Job.StartedMS}
		e.phaseLocked("prepared", "")
		e.mu.Unlock()
		return
	}
	// No remote reads, image loading, or compilation on the restart path. Recheck
	// actual retained image identities and current backup headroom before fencing.
	if action == "apply" && (!idRE.MatchString(preparedID) || atomicBytes(filepath.Join(dir, "staging-job"), []byte(preparedID), 0600) != nil) {
		e.phase("refused", "job_storage")
		return
	}
	if call("restart-preflight") != nil {
		e.phase("refused", "capacity_or_images")
		return
	}
	for _, p := range []string{"fencing", "draining", "backup", "migration", "switching", "health", "commit"} {
		if e.phase(p, "") != nil {
			return
		}
		if call(p) != nil {
			if p != "commit" && call("restore-old") == nil {
				e.phase("restored", "old_version_verified")
				return
			}
			e.phase("recovery_required", "preserve_and_recover")
			return
		}
	}
	e.mu.Lock()
	e.st.Previous = &old
	e.st.Current = next
	e.st.Candidate = nil
	e.st.Prepared = nil
	err := e.save()
	e.mu.Unlock()
	if err != nil {
		return
	}
	if call("unfence") != nil {
		e.phase("recovery_required", "preserve_and_recover")
		return
	}
	e.phase("succeeded", "")
}

// A crash never reruns a migration or guesses which pointer reached disk.
func (e *engine) reconcile() error {
	j := e.st.Job
	if !active(j) {
		return e.projection()
	}
	if contains([]string{"admission", "downloading", "staging"}, j.Phase) {
		return e.phase("refused", "interrupted_before_maintenance")
	}
	dir := filepath.Join(e.root, "jobs", j.ID)
	if j.Phase == "commit" && identity(e.st.Current) == j.Target {
		if _, x := e.h.perform("reconcile-committed", e.st.Current, e.st.Current, e.st.Fingerprint, dir); x == nil {
			return e.phase("succeeded", "")
		}
	}
	if j.Phase != "commit" {
		old := e.st.Current
		var next *Release
		if j.Action == "apply" && e.st.Candidate != nil {
			next = &e.st.Candidate.Release
		} else if j.Action == "rollback" {
			next = e.st.Previous
		}
		if next != nil && identity(*next) == j.Target {
			if _, x := e.h.perform("restore-old", old, *next, e.st.Fingerprint, dir); x == nil {
				return e.phase("restored", "old_version_verified")
			}
		}
	}
	return e.phase("recovery_required", "preserve_and_recover")
}
