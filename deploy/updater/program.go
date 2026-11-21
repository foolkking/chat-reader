package main

import "path/filepath"

type programJournal struct {
	Old, Next Release
	Plan      cutover
	Stage     string
	Rollback  bool
}

func (e *engine) endProgram(phase, reason string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	// A new container/recovery check needs a fresh prepared receipt even if
	// the program was restored to the original human-readable version.
	e.st.Prepared = nil
	return e.phaseLocked(phase, reason)
}

func (e *engine) finishProgram(j programJournal) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.st.Previous = &j.Old
	e.st.Current = j.Next
	e.st.FastPrevious = &fastPair{StageID: j.Stage, Plan: j.Plan}
	e.st.Candidate = nil
	e.st.Prepared = nil
	return e.phaseLocked("succeeded", "")
}

func (e *engine) program(dir string, old, next Release, fp, stage string, p cutover, action string) {
	j := programJournal{old, next, p, stage, action == "rollback"}
	if atomic(filepath.Join(dir, "program.json"), j, 0600) != nil {
		e.phase("refused", "job_storage")
		return
	}
	call := func(op string) bool { _, err := e.h.perform(op, old, next, fp, dir); return err == nil }
	if !call("program-preflight") {
		e.endProgram("refused", "recovery_or_profile")
		return
	}
	for _, phase := range []string{"program-switch", "program-health", "program-commit"} {
		if e.phase(phase, "") != nil {
			return
		}
		if !call(phase) {
			if phase != "program-commit" && call("program-restore") {
				e.endProgram("restored", "old_version_verified")
				return
			}
			e.phase("recovery_required", "preserve_and_recover")
			return
		}
	}
	e.finishProgram(j)
}

func (e *engine) reconcileProgram(dir string) error {
	var j programJournal
	job := e.st.Job
	if readJSON(filepath.Join(dir, "program.json"), &j) == nil && j.Plan.Mode == "program" && idRE.MatchString(j.Stage) &&
		identity(j.Old) == job.Expected && identity(j.Next) == job.Target && identity(e.st.Current) == job.Expected {
		call := func(op string) bool {
			_, err := e.h.perform(op, j.Old, j.Next, e.st.Fingerprint, dir)
			return err == nil
		}
		if job.Phase == "program-commit" && call("program-committed") {
			return e.finishProgram(j)
		}
		if call("program-restore") {
			return e.endProgram("restored", "old_version_verified")
		}
	}
	return e.phase("recovery_required", "preserve_and_recover")
}
