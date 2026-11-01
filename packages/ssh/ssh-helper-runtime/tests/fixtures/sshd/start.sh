#!/bin/sh
set -eu
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
install -d -m 700 -o liwa -g liwa /home/liwa/.ssh
install -m 600 -o liwa -g liwa /fixture-key.pub /home/liwa/.ssh/authorized_keys
install -d -m 700 -o liwa -g liwa /home/liwa/workspace
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
