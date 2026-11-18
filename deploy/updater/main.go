package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type host struct{}

func (host) perform(op string, old, next Release, fp, dir string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	data, _ := json.Marshal(map[string]any{"old": old, "next": next, "fingerprint": fp, "directory": dir})
	cmd := exec.CommandContext(ctx, "/usr/bin/python3", "-I", helper, op)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "HOME=/root"}
	cmd.Stdin = bytes.NewReader(data)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	if err := cmd.Run(); err != nil {
		return "", errors.New("host_check_failed")
	}
	return strings.TrimSpace(buf.String()), nil
}

const cookieName = "cr_update_monitor"
const monitorPath = "/__updates/"

func jsonOut(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func (e *engine) commands(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/state" {
		jsonOut(w, 200, e.view())
		return
	}
	if r.Method != "POST" {
		http.NotFound(w, r)
		return
	}
	b, x := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	if x != nil {
		jsonOut(w, 400, "invalid_request")
		return
	}
	switch r.URL.Path {
	case "/check":
		if strings.TrimSpace(string(b)) != "{}" {
			jsonOut(w, 400, "invalid_request")
			return
		}
		if e.check() != nil {
			jsonOut(w, 409, "check_failed")
			return
		}
		jsonOut(w, 200, e.view())
	case "/ticket":
		var q struct {
			ID string `json:"id"`
		}
		if strict(b, &q) != nil {
			jsonOut(w, 400, "invalid_request")
			return
		}
		t, x := e.ticket(q.ID)
		if x != nil {
			jsonOut(w, 409, "busy")
			return
		}
		jsonOut(w, 200, map[string]string{"ticket": t})
	case "/prepare", "/apply", "/rollback":
		var i intent
		if strict(b, &i) != nil {
			jsonOut(w, 400, "invalid_request")
			return
		}
		if x = e.start(r.URL.Path[1:], i); x != nil {
			jsonOut(w, 409, "stale_or_incompatible")
			return
		}
		jsonOut(w, 202, e.view())
	default:
		http.NotFound(w, r)
	}
}

var messages = map[string][2]string{
	"staging":   {"核验并预装镜像；旧服务在线", "Verifying and loading images; the existing service is online"},
	"prepared":  {"下载和验证完成。返回管理后台，准备好后再确认重启。", "Download and verification complete. Return to administration to confirm the restart when ready."},
	"admission": {"检查更新条件", "Checking prerequisites"}, "downloading": {"下载并校验镜像", "Verifying download"}, "fencing": {"暂停访问，保护写入", "Closing ingress"}, "draining": {"等待后台任务完成", "Draining worker"}, "backup": {"备份数据库和文件", "Backing up database and files"}, "migration": {"检查并迁移数据库", "Verifying database schema"}, "switching": {"切换应用镜像", "Switching images"}, "health": {"验证应用和后台任务", "Checking services and worker"}, "commit": {"确认版本", "Confirming version"}, "succeeded": {"更新完成", "Update complete"}, "restored": {"已恢复原版本", "Previous version restored"}, "refused": {"未更新，旧服务不变", "Update refused; previous version unchanged"}, "recovery_required": {"需人工恢复，已保留数据和备份。请在隔离实例中验证恢复，切勿降库或删除卷。", "Recovery required. Keep the backup and journal; restore only into an isolated instance. Do not downgrade or delete volumes."},
}
var reasons = map[string][2]string{
	"job_storage": {"无法写入任务目录。", "Cannot write job directory."}, "configuration_or_runtime": {"来源、挂载、运行版本或配置与接入基线不一致。", "Source, mounts, active release or configuration differs from the enrolled baseline."}, "configuration_changed": {"停服前配置发生变化。", "Configuration changed during staging."}, "source_changed": {"发行版本或来源已变化，请重新检查。", "Release changed; check again."}, "insufficient_space": {"磁盘空间不足；没有删除备份。", "Insufficient disk space. No backups were deleted."}, "capacity_or_images": {"空间或镜像身份校验未通过。", "Capacity or image verification failed."}, "download_verification": {"下载失败或文件校验不符。", "Download or archive verification failed."}, "unsafe_rollback": {"无法证明回滚安全。", "Rollback safety could not be established."}, "old_version_verified": {"原版本和数据库已重新核验。", "The original version and database were checked."}, "preserve_and_recover": {"保留现场；参照宿主机隔离恢复手册。", "Keep the host state and follow the isolated recovery runbook."}, "interrupted_before_maintenance": {"维护前中断，可重新检查。", "Interrupted before maintenance. Check again."},
}
var progressPage = template.Must(template.New("progress").Parse(`<!doctype html><html lang="{{.Lang}}"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">{{if .Refresh}}<meta http-equiv=refresh content=4>{{end}}<title>{{.Title}}</title><style>body{font:1rem/1.6 system-ui;margin:10vh auto;padding:0 1.25rem;max-width:36rem;color:#302f2b;background:#f6f4ef}h1{font-size:1.25rem}a{color:#166957}</style><main><h1>{{.Title}}</h1><p role=status>{{.Message}}</p><p>{{.Detail}}</p><a href="/">{{.Back}}</a></main></html>`))

func progress(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		if (r.Method != "GET" && r.Method != "HEAD") || r.URL.RawQuery != "" || (r.URL.Path != monitorPath && r.URL.Path != monitorPath+"status") {
			http.NotFound(w, r)
			return
		}
		c, err := r.Cookie(cookieName)
		var g grant
		if err != nil || !hashRE.MatchString(c.Value) || readJSON(filepath.Join(dir, "ticket.json"), &g) != nil || g.Expires <= time.Now().Unix() || subtle.ConstantTimeCompare([]byte(hash([]byte(c.Value))), []byte(g.Hash)) != 1 {
			http.NotFound(w, r)
			return
		}
		var j job
		if readJSON(filepath.Join(dir, "progress.json"), &j) != nil || j.ID != g.ID {
			j.Phase = "admission"
			j.Reason = ""
		}
		msg, ok := messages[j.Phase]
		if !ok {
			http.Error(w, "Unavailable", 503)
			return
		}
		if r.URL.Path == monitorPath+"status" {
			jsonOut(w, 200, map[string]any{"phase": j.Phase, "reason": j.Reason, "updated": j.Updated, "timings_ms": j.Times})
			return
		}
		idx := 1
		lang, title, back := "en", "Version update", "Return to Chat Reader"
		if strings.HasPrefix(strings.ToLower(r.Header.Get("Accept-Language")), "zh") {
			idx = 0
			lang, title, back = "zh-CN", "版本更新", "返回 Chat Reader"
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		progressPage.Execute(w, map[string]any{"Lang": lang, "Title": title, "Back": back, "Message": msg[idx], "Detail": reasons[j.Reason][idx], "Refresh": active(&j)})
	}
}
func serve(sock string, gid, uid int, h http.Handler) error {
	if i, e := os.Lstat(sock); e == nil {
		if i.Mode()&os.ModeSocket == 0 {
			return errors.New("invalid socket path")
		}
		if e = os.Remove(sock); e != nil {
			return e
		}
	}
	l, e := net.Listen("unix", sock)
	if e != nil {
		return e
	}
	defer l.Close()
	if gid >= 0 {
		if e = os.Chown(sock, -1, gid); e != nil {
			return e
		}
	}
	if e = os.Chmod(sock, 0660); e != nil {
		return e
	}
	return (&http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 4096}).Serve(permitted(l, uid))
}
func run() error {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" || len(os.Args) != 2 {
		return errors.New("usage: updater enroll | control | progress")
	}
	if os.Args[1] == "progress" {
		return serve("/run/chat-reader-update-status/status.sock", -1, -1, progress(publicRoot))
	}
	c := Config{Channel: "stable"}
	if readJSON(etc+"/source.json", &c) != nil || !c.valid() {
		return errors.New("invalid source configuration")
	}
	unlock, err := lockHost()
	if err != nil {
		return err
	}
	defer unlock()
	token, err := os.ReadFile(etc + "/release-read-token")
	if err != nil && !os.IsNotExist(err) {
		return errors.New("credential unreadable")
	}
	e := &engine{c: c, root: stateRoot, public: publicRoot, h: host{}, s: newSource(c, strings.TrimSpace(string(token))), launch: func(f func()) { go f() }}
	if os.Args[1] == "enroll" {
		if _, x := os.Lstat(stateRoot + "/state.json"); !os.IsNotExist(x) {
			return errors.New("already enrolled or unreadable")
		}
		var old Release
		if raw, x := os.ReadFile(etc + "/installed-update-v1.json"); x == nil {
			sig, x := os.ReadFile(etc + "/installed-update-v1.json.sig")
			if x != nil || strict(raw, &old) != nil {
				return errors.New("invalid signed baseline")
			}
			old, x = verified(c, old.Version, raw, sig)
			if x != nil {
				return x
			}
		} else if !os.IsNotExist(x) || readJSON(etc+"/baseline.json", &old) != nil || !shaRE.MatchString(old.Revision) || !schemaRE.MatchString(old.Schema) || old.Repository != c.Repository || old.RepoID != c.RepoID || old.Version != "legacy" || old.ABI != "local-assets-v1" || old.JobABI != "reader-jobs-v1" {
			return errors.New("invalid baseline")
		}
		fp, x := e.h.perform("enroll", old, old, "", "")
		if x != nil || !hashRE.MatchString(fp) {
			return errors.New("running instance does not match trusted baseline")
		}
		e.st.Current = old
		e.st.Fingerprint = fp
		return e.save()
	}
	if os.Args[1] != "control" {
		return errors.New("unknown command")
	}
	if err = readJSON(stateRoot+"/state.json", &e.st); err != nil {
		return errors.New("enroll verified current instance first")
	}
	if e.st.Current.Repository != c.Repository || e.st.Current.RepoID != c.RepoID {
		return errors.New("enrolled source changed")
	}
	if err = e.reconcile(); err != nil {
		return err
	}
	return serve("/run/chat-reader-updater/control.sock", c.CommandGID, c.CommandUID, http.HandlerFunc(e.commands))
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "Updater unavailable: verify enrollment, permissions, configuration and local journal.")
		os.Exit(1)
	}
}
