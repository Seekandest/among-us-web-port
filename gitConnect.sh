#!/usr/bin/env bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_github
echo "SSH agent started and key added."
