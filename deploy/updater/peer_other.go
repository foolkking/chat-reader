//go:build !linux

package main

import (
	"errors"
	"net"
)

// Portable unit tests exercise protocol logic; no non-Linux command server exists.
func permitted(net.Listener, int) net.Listener { panic("Linux host required") }
func lockHost() (func(), error)                { return nil, errors.New("Linux host required") }
