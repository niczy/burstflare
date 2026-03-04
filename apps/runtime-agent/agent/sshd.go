package agent

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ensureSshdOnce sync.Once
var ensureSshdErr error

func sshPort() int {
	raw := strings.TrimSpace(os.Getenv("BURSTFLARE_SSH_PORT"))
	if raw == "" {
		return 2222
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 2222
	}
	return parsed
}

func noDeadline() time.Time {
	return time.Time{}
}

func resolveSftpServerPath() string {
	candidates := []string{
		"/usr/lib/ssh/sftp-server",
		"/usr/libexec/sftp-server",
		"/usr/lib/openssh/sftp-server",
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return candidates[0]
}

func ensureRuntimeHostKey() (string, error) {
	hostKeyPath := "/tmp/burstflare-ssh_host_ed25519_key"
	if _, err := os.Stat(hostKeyPath); err == nil {
		return hostKeyPath, nil
	}
	command := exec.Command("/usr/bin/ssh-keygen", "-t", "ed25519", "-N", "", "-f", hostKeyPath)
	command.Stdout = ioDiscard()
	command.Stderr = ioDiscard()
	if err := command.Run(); err != nil {
		return "", fmt.Errorf("failed to generate the runtime SSH host key: %w", err)
	}
	return hostKeyPath, nil
}

func waitForPortReady(targetPort int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", targetPort), 250*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("sshd did not become ready on port %d", targetPort)
}

func EnsureSshd() error {
	ensureSshdOnce.Do(func() {
		if err := os.MkdirAll("/run/sshd", 0o755); err != nil {
			ensureSshdErr = err
			return
		}
		if err := os.MkdirAll("/var/run/sshd", 0o755); err != nil {
			ensureSshdErr = err
			return
		}

		configPath := "/tmp/burstflare-sshd_config"
		hostKeyPath, err := ensureRuntimeHostKey()
		if err != nil {
			ensureSshdErr = err
			return
		}

		config := strings.Join(
			[]string{
				fmt.Sprintf("Port %d", sshPort()),
				"ListenAddress 127.0.0.1",
				"Protocol 2",
				fmt.Sprintf("HostKey %s", hostKeyPath),
				"PermitRootLogin no",
				"PasswordAuthentication no",
				"PubkeyAuthentication yes",
				"PermitEmptyPasswords no",
				"ChallengeResponseAuthentication no",
				"AllowTcpForwarding yes",
				"X11Forwarding no",
				"PidFile /tmp/burstflare-sshd.pid",
				"PrintMotd no",
				"Subsystem sftp " + resolveSftpServerPath(),
			},
			"\n",
		) + "\n"
		if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
			ensureSshdErr = err
			return
		}

		command := exec.Command("/usr/sbin/sshd", "-D", "-e", "-f", configPath)
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err := command.Start(); err != nil {
			ensureSshdErr = err
			return
		}
		go func() {
			err := command.Wait()
			if err != nil {
				_, _ = os.Stderr.WriteString(fmt.Sprintf("BurstFlare sshd exited with error: %v\n", err))
			}
		}()

		ensureSshdErr = waitForPortReady(sshPort(), 3*time.Second)
	})
	return ensureSshdErr
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) {
	return len(p), nil
}

func ioDiscard() discardWriter {
	return discardWriter{}
}
