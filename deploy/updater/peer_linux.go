//go:build linux

package main

import (
	"net"
	"os"
	"syscall"
)

type peers struct {
	net.Listener
	uid uint32
}

func (p peers) Accept() (net.Conn, error) {
	for {
		c, x := p.Listener.Accept()
		if x != nil {
			return nil, x
		}
		u, ok := c.(*net.UnixConn)
		if ok {
			raw, e := u.SyscallConn()
			if e == nil {
				var cred *syscall.Ucred
				err := raw.Control(func(fd uintptr) { cred, _ = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED) })
				if err == nil && cred != nil && cred.Uid == p.uid {
					return c, nil
				}
			}
		}
		c.Close()
	}
}
func permitted(l net.Listener, uid int) net.Listener {
	if uid < 0 {
		return l
	}
	return peers{l, uint32(uid)}
}
func lockHost() (func(), error) {
	f, e := os.OpenFile(stateRoot+"/coordinator.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, e
	}
	return func() { f.Close() }, nil
}
