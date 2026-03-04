package agent

import (
	"os/exec"
	"strconv"
	"strings"
)

func runtimeUserIdentity() (int, int, bool) {
	uidResult, uidErr := exec.Command("id", "-u", "flare").Output()
	gidResult, gidErr := exec.Command("id", "-g", "flare").Output()
	if uidErr != nil || gidErr != nil {
		return 0, 0, false
	}

	uid, uidParseErr := strconv.Atoi(strings.TrimSpace(string(uidResult)))
	gid, gidParseErr := strconv.Atoi(strings.TrimSpace(string(gidResult)))
	if uidParseErr != nil || gidParseErr != nil {
		return 0, 0, false
	}
	return uid, gid, true
}
