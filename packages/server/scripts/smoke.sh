#!/bin/bash
# MyChat phase-1 REST smoke test (steps 1-3 verification)
set -u
API=http://127.0.0.1:8787
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1  -- $2"; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

TS=$(date +%s)
A_EMAIL="alice.$TS@example.com"; B_EMAIL="bob.$TS@example.com"; C_EMAIL="carol.$TS@example.com"

# ---- auth ----
R=$(curl -s -X POST $API/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$A_EMAIL\",\"password\":\"password123\",\"displayName\":\"Alice\"}")
AT=$(echo "$R" | j "['token']"); AID=$(echo "$R" | j "['user']['id']")
[ -n "$AT" ] && ok "register alice" || fail "register alice" "$R"

R=$(curl -s -X POST $API/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$B_EMAIL\",\"password\":\"password123\",\"displayName\":\"Bob\"}")
BT=$(echo "$R" | j "['token']"); BID=$(echo "$R" | j "['user']['id']")

R=$(curl -s -X POST $API/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$C_EMAIL\",\"password\":\"password123\",\"displayName\":\"Carol\"}")
CT=$(echo "$R" | j "['token']")

# duplicate email → 409
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$A_EMAIL\",\"password\":\"password123\",\"displayName\":\"Dup\"}")
[ "$CODE" = 409 ] && ok "duplicate register -> 409" || fail "duplicate register" "got $CODE"

# login wrong password → 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$A_EMAIL\",\"password\":\"wrongpass\"}")
[ "$CODE" = 401 ] && ok "bad password -> 401" || fail "bad password" "got $CODE"

# login → fresh token works on /v1/me
R=$(curl -s -X POST $API/v1/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$A_EMAIL\",\"password\":\"password123\"}")
AT2=$(echo "$R" | j "['token']")
ME=$(curl -s $API/v1/me -H "authorization: Bearer $AT2" | j "['email']")
[ "$ME" = "$A_EMAIL" ] && ok "login + GET /v1/me" || fail "login/me" "$ME"

# bad token → 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/me -H "authorization: Bearer notatoken")
[ "$CODE" = 401 ] && ok "invalid token -> 401" || fail "invalid token" "got $CODE"

# ---- workspaces ----
R=$(curl -s -X POST $API/v1/workspaces -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"name\":\"Acme $TS\",\"slug\":\"acme-$TS\"}")
WS=$(echo "$R" | j "['id']")
[ -n "$WS" ] && ok "create workspace (alice owner)" || fail "create workspace" "$R"

ROLE=$(curl -s $API/v1/me/workspaces -H "authorization: Bearer $AT" | j "['workspaces'][0]['role']")
[ "$ROLE" = owner ] && ok "my workspaces shows owner role" || fail "my workspaces role" "$ROLE"

# #general auto-created
R=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT")
GEN=$(echo "$R" | j "['channels'][0]['id']")
GENNAME=$(echo "$R" | j "['channels'][0]['name']")
[ "$GENNAME" = general ] && ok "#general auto-created" || fail "#general" "$R"

# non-member can't see workspace → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/workspaces/$WS" -H "authorization: Bearer $CT")
[ "$CODE" = 404 ] && ok "non-member GET workspace -> 404" || fail "non-member workspace" "got $CODE"

# ---- invites ----
R=$(curl -s -X POST "$API/v1/workspaces/$WS/invites" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"email\":\"$B_EMAIL\"}")
IURL=$(echo "$R" | j "['inviteUrl']")
ITOK=${IURL##*/}
[ -n "$ITOK" ] && ok "create invite (owner)" || fail "create invite" "$R"

# member (not admin) can't invite
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WS/invites" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d "{\"email\":\"x@example.com\"}")
[ "$CODE" = 404 ] && ok "non-member create invite -> 404" || fail "non-member invite" "got $CODE"

R=$(curl -s -X POST $API/v1/invites/accept -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"token\":\"$ITOK\"}")
JOINED=$(echo "$R" | j "['id']")
[ "$JOINED" = "$WS" ] && ok "bob accepts invite" || fail "accept invite" "$R"

# reuse invite → 409
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/invites/accept -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "{\"token\":\"$ITOK\"}")
[ "$CODE" = 409 ] && ok "reused invite -> 409" || fail "reused invite" "got $CODE"

N=$(curl -s "$API/v1/workspaces/$WS/members" -H "authorization: Bearer $AT" | j "['members'].__len__()")
[ "$N" = 2 ] && ok "members list = 2" || fail "members list" "$N"

# bob (role member) can't invite → 403
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WS/invites" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d "{\"email\":\"y@example.com\"}")
[ "$CODE" = 403 ] && ok "member create invite -> 403" || fail "member invite" "got $CODE"

# ---- channels ----
DEV=$(curl -s -X POST "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"dev","topic":"dev talk"}' | j "['id']")
SECRET=$(curl -s -X POST "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"secret","isPrivate":true}' | j "['id']")
[ -n "$DEV" ] && [ -n "$SECRET" ] && ok "create public + private channels" || fail "create channels" "$DEV/$SECRET"

# dup channel name → 409
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"name":"dev"}')
[ "$CODE" = 409 ] && ok "duplicate channel -> 409" || fail "dup channel" "got $CODE"

# bob sees general+dev but NOT secret
R=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT")
NAMES=$(echo "$R" | python3 -c "import sys,json; print(sorted(c['name'] for c in json.load(sys.stdin)['channels']))")
[ "$NAMES" = "['dev', 'general']" ] && ok "private channel hidden from bob" || fail "channel visibility" "$NAMES"

# bob can't read private channel messages → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/channels/$SECRET/messages" -H "authorization: Bearer $BT")
[ "$CODE" = 404 ] && ok "private channel read (non-member) -> 404" || fail "private read" "got $CODE"

# bob joins dev
R=$(curl -s -X POST "$API/v1/channels/$DEV/join" -H "authorization: Bearer $BT" | j "['isMember']")
[ "$R" = True ] && ok "bob joins #dev" || fail "join dev" "$R"

# ---- messages ----
u() { python3 -c "import uuid; print(uuid.uuid4())"; }
M1CID=$(u)
M1=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$M1CID\",\"body\":\"hello **world** one\"}")
M1ID=$(echo "$M1" | j "['id']")
[ -n "$M1ID" ] && ok "alice sends message 1" || fail "send msg1" "$M1"

# idempotent resend: same clientMsgId → same id
M1B=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$M1CID\",\"body\":\"hello **world** one\"}" | j "['id']")
[ "$M1B" = "$M1ID" ] && ok "idempotent resend returns same id" || fail "idempotency" "$M1B vs $M1ID"

M2ID=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"msg two from bob\"}" | j "['id']")
M3ID=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"msg three\"}" | j "['id']")

# thread replies
R1=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"reply one\",\"threadRootId\":\"$M1ID\"}")
R1ID=$(echo "$R1" | j "['id']")
R2ID=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"reply two\",\"threadRootId\":\"$M1ID\"}" | j "['id']")
[ -n "$R1ID" ] && [ -n "$R2ID" ] && ok "thread replies" || fail "thread replies" "$R1"

# reply-to-reply must fail
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"nested\",\"threadRootId\":\"$R1ID\"}")
[ "$CODE" = 400 ] && ok "reply-to-reply -> 400" || fail "nested reply" "got $CODE"

# history: top-level only, newest first, cursor pagination
P1=$(curl -s "$API/v1/channels/$GEN/messages?limit=2" -H "authorization: Bearer $AT")
IDS=$(echo "$P1" | python3 -c "import sys,json; d=json.load(sys.stdin); print([m['id'] for m in d['messages']], d['hasMore'])")
TOP0=$(echo "$P1" | j "['messages'][0]['id']"); TOP1=$(echo "$P1" | j "['messages'][1]['id']")
HM=$(echo "$P1" | j "['hasMore']")
[ "$TOP0" = "$M3ID" ] && [ "$TOP1" = "$M2ID" ] && [ "$HM" = True ] && ok "history newest-first, hasMore" || fail "history page1" "$IDS"

P2=$(curl -s "$API/v1/channels/$GEN/messages?limit=2&before=$TOP1" -H "authorization: Bearer $AT")
N0=$(echo "$P2" | j "['messages'][0]['id']"); HM2=$(echo "$P2" | j "['hasMore']")
[ "$N0" = "$M1ID" ] && [ "$HM2" = False ] && ok "cursor pagination (before)" || fail "history page2" "$(echo $P2)"

# replies excluded from history; root rollup present
RC=$(echo "$P2" | j "['messages'][0]['replyCount']")
[ "$RC" = 2 ] && ok "root replyCount=2 rollup" || fail "replyCount" "$RC"

# thread fetch
TH=$(curl -s "$API/v1/messages/$M1ID/thread" -H "authorization: Bearer $BT")
TN=$(echo "$TH" | j "['messages'].__len__()"); TROOT=$(echo "$TH" | j "['root']['id']")
T0=$(echo "$TH" | j "['messages'][0]['id']")
[ "$TN" = 2 ] && [ "$TROOT" = "$M1ID" ] && [ "$T0" = "$R1ID" ] && ok "thread fetch (root + ascending replies)" || fail "thread" "$TH"

# thread cursor: after=first reply
TH2=$(curl -s "$API/v1/messages/$M1ID/thread?after=$R1ID" -H "authorization: Bearer $BT")
TN2=$(echo "$TH2" | j "['messages'].__len__()"); T20=$(echo "$TH2" | j "['messages'][0]['id']")
[ "$TN2" = 1 ] && [ "$T20" = "$R2ID" ] && ok "thread cursor (after)" || fail "thread after" "$TH2"

# edit own message
ED=$(curl -s -X PATCH "$API/v1/messages/$M3ID" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"body":"msg three (edited)"}')
EB=$(echo "$ED" | j "['body']"); EEA=$(echo "$ED" | j "['editedAt']")
[ "$EB" = "msg three (edited)" ] && [ "$EEA" != None ] && ok "edit own message" || fail "edit" "$ED"

# edit someone else's → 403
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/messages/$M3ID" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d '{"body":"hax"}')
[ "$CODE" = 403 ] && ok "edit other's message -> 403" || fail "edit perms" "got $CODE"

# delete own; body must come back empty + deletedAt set
curl -s -X DELETE "$API/v1/messages/$M2ID" -H "authorization: Bearer $BT" >/dev/null
DM=$(curl -s "$API/v1/channels/$GEN/messages?limit=10" -H "authorization: Bearer $AT" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); m=[x for x in d['messages'] if x['id']=='$M2ID'][0]; print(m['body'], m['deletedAt'] is not None)")
[ "$DM" = " True" ] && ok "soft delete (empty body, deletedAt)" || fail "delete" "$DM"

# auto-join public channel on first post (carol not in workspace -> 404; bob posts to random)
RAND=$(curl -s -X POST "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"name":"random"}' | j "['id']")
curl -s -X POST "$API/v1/channels/$RAND/messages" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"bob auto-joins\"}" >/dev/null
IM=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT" | \
  python3 -c "import sys,json; print([c['isMember'] for c in json.load(sys.stdin)['channels'] if c['name']=='random'][0])")
[ "$IM" = True ] && ok "auto-join public channel on first post" || fail "auto-join" "$IM"

# carol (not in workspace) can't post → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "{\"clientMsgId\":\"$(u)\",\"body\":\"intruder\"}")
[ "$CODE" = 404 ] && ok "outsider post -> 404" || fail "outsider post" "got $CODE"

# ---- read state / unread counts ----
UC=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT" | \
  python3 -c "import sys,json; print([c['unreadCount'] for c in json.load(sys.stdin)['channels'] if c['name']=='general'][0])")
# general has M1, M3 live (M2 was soft-deleted above; deleted msgs don't count)
[ "$UC" = 2 ] && ok "unread count before read = 2 (excludes deleted)" || fail "unread before" "$UC"
curl -s -X POST "$API/v1/channels/$GEN/read" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"lastReadMsgId\":\"$M3ID\"}" >/dev/null
UC2=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT" | \
  python3 -c "import sys,json; print([c['unreadCount'] for c in json.load(sys.stdin)['channels'] if c['name']=='general'][0])")
[ "$UC2" = 0 ] && ok "unread count after mark read = 0" || fail "unread after" "$UC2"

# ---- logout ----
curl -s -X POST $API/v1/auth/logout -H "authorization: Bearer $AT2" >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/me -H "authorization: Bearer $AT2")
[ "$CODE" = 401 ] && ok "logout revokes token" || fail "logout" "got $CODE"

# ---- encryption at rest: raw DB row must not contain plaintext ----
RAW=$(docker exec mychat-postgres psql -U mychat -d mychat -t -A -c \
  "SELECT enc_scheme || '|' || enc_key_id || '|' || encode(body,'escape') FROM messages WHERE id='$M1ID'")
echo "$RAW" | grep -q "hello" && fail "encryption at rest" "plaintext found in DB!" || ok "message body is ciphertext in DB (no plaintext)"
echo "$RAW" | grep -q "^1|" && ok "enc_scheme=1 (aes-256-gcm-v1) with key id" || fail "enc metadata" "$RAW"

echo
echo "=== RESULT: $PASS passed, $FAIL failed ==="
exit $([ $FAIL = 0 ] && echo 0 || echo 1)
