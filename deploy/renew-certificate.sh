#!/bin/sh
set -eu
/opt/certbot/bin/certbot renew --cert-name mes.xiaomtech.cn --quiet --deploy-hook 'nginx -t && nginx -s reload'
