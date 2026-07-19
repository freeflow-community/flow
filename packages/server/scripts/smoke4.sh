#!/bin/bash
# Flow phase-4 smoke: Slack compat surface (Web API + Events API outbox).
# Requires the server running and jq-free (python3 for JSON).
set -u
API=http://127.0.0.1:8787
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1  -- $2"; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }
u() { python3 -c "import uuid; print(uuid.uuid4())"; }
TS=$(date +%s)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; kill $BOTPID 2>/dev/null' EXIT

# ---- setup: fresh workspace so events are isolated ----
reg() { curl -s -X POST $API/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"password123\",\"displayName\":\"$2\",\"autoVerify\":true}"; }
A=$(reg "owner.$TS@p4.test" "Olivia Owner")
AT=$(echo "$A" | j "['token']"); AID=$(echo "$A" | j "['user']['id']")
WS=$(curl -s -X POST $API/v1/workspaces -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"name\":\"P4 $TS\",\"slug\":\"p4-$TS\"}" | j "['id']")
GEN=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" | j "['channels'][0]['id']")

# ---- app registration ----
R=$(curl -s -X POST "$API/v1/workspaces/$WS/apps" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"smoke4bot"}')
APPID=$(echo "$R" | j "['app']['id']"); BT=$(echo "$R" | j "['botToken']"); BOTUID=$(echo "$R" | j "['app']['botUserId']")
case "$BT" in xoxb-*) ok "app created, xoxb- token issued once" ;; *) fail "app create" "$R" ;; esac

SECRET=$(docker exec flow-postgres psql -U flow -d flow -t -A -c "SELECT signing_secret FROM apps WHERE id='$APPID'")

# ---- Web API: auth + basics ----
AUTH=$(curl -s -X POST $API/api/auth.test -H "authorization: Bearer $BT")
[ "$(echo "$AUTH" | j "['ok']")" = True ] && [ "$(echo "$AUTH" | j "['team_id']")" = "$WS" ] \
  && ok "auth.test ok envelope + team_id" || fail "auth.test" "$AUTH"
BAD=$(curl -s -X POST $API/api/auth.test -H "authorization: Bearer xoxb-nope")
[ "$(echo "$BAD" | j "['ok']")" = False ] && [ "$(echo "$BAD" | j "['error']")" = invalid_auth ] \
  && ok "bad token -> ok:false invalid_auth (HTTP 200)" || fail "invalid_auth" "$BAD"
UM=$(curl -s -X POST $API/api/definitely.not.a.method -H "authorization: Bearer $BT" | j "['error']")
[ "$UM" = unknown_method ] && ok "unknown method -> unknown_method" || fail "unknown_method" "$UM"

CL=$(curl -s -X POST $API/api/conversations.list -H "authorization: Bearer $BT")
[ "$(echo "$CL" | j "['channels'][0]['name']")" = general ] && ok "conversations.list shows #general" || fail "conv.list" "$CL"

JN=$(curl -s -X POST $API/api/conversations.join -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\"}")
[ "$(echo "$JN" | j "['ok']")" = True ] && ok "conversations.join #general" || fail "join" "$JN"

# ---- chat.postMessage with mrkdwn + form encoding + #name channel ----
PM=$(curl -s -X POST $API/api/chat.postMessage -H "authorization: Bearer $BT" \
  --data-urlencode "channel=#general" --data-urlencode "text=*bold* and <https://x.test|a link> s4-$TS")
MTS=$(echo "$PM" | j "['ts']")
[ "$(echo "$PM" | j "['ok']")" = True ] && [ -n "$MTS" ] && ok "chat.postMessage (form-encoded, #name channel) -> ts" || fail "postMessage" "$PM"

# stored body is converted markdown; verify via native API as the owner
STORED=$(curl -s "$API/v1/channels/$GEN/messages?limit=5" -H "authorization: Bearer $AT" | \
  python3 -c "import sys,json; ms=[m['body'] for m in json.load(sys.stdin)['messages'] if 's4-$TS' in m['body']]; print(ms[0] if ms else '')")
case "$STORED" in **bold***"[a link](https://x.test)"*) ok "mrkdwn converted to markdown in storage" ;; *) fail "mrkdwn convert" "$STORED" ;; esac

HI=$(curl -s -X POST $API/api/conversations.history -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"limit\":5}")
FOUND=$(echo "$HI" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(m['ts']=='$MTS' for m in d['messages']))")
[ "$FOUND" = True ] && ok "conversations.history round-trips ts" || fail "history ts" "$HI"

UP=$(curl -s -X POST $API/api/chat.update -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"ts\":\"$MTS\",\"text\":\"edited s4-$TS\"}" | j "['ok']")
[ "$UP" = True ] && ok "chat.update by ts" || fail "chat.update" "$UP"

RA=$(curl -s -X POST $API/api/reactions.add -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"timestamp\":\"$MTS\",\"name\":\"thumbsup\"}" | j "['ok']")
[ "$RA" = True ] && ok "reactions.add thumbsup" || fail "reactions.add" "$RA"
RA2=$(curl -s -X POST $API/api/reactions.add -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"timestamp\":\"$MTS\",\"name\":\"thumbsup\"}" | j "['error']")
[ "$RA2" = already_reacted ] && ok "duplicate reaction -> already_reacted" || fail "already_reacted" "$RA2"
RN=$(curl -s -X POST $API/api/reactions.add -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"timestamp\":\"$MTS\",\"name\":\"not_a_real_emoji_name\"}" | j "['error']")
[ "$RN" = invalid_name ] && ok "unknown reaction name -> invalid_name" || fail "invalid_name" "$RN"

# thread via thread_ts + replies
TR=$(curl -s -X POST $API/api/chat.postMessage -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"text\":\"threaded s4-$TS\",\"thread_ts\":\"$MTS\"}")
[ "$(echo "$TR" | j "['message']['thread_ts']")" = "$MTS" ] && ok "threaded post carries thread_ts" || fail "thread post" "$TR"
RP=$(curl -s -X POST $API/api/conversations.replies -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"ts\":\"$MTS\"}")
RPN=$(echo "$RP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))")
[ "$RPN" -ge 2 ] && ok "conversations.replies returns root+reply" || fail "replies" "$RP"

# DM upsert + users.*
OP=$(curl -s -X POST $API/api/conversations.open -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"users\":\"$AID\"}")
DMID=$(echo "$OP" | j "['channel']['id']")
[ -n "$DMID" ] && ok "conversations.open upserts DM" || fail "conv.open" "$OP"
UL=$(curl -s -X POST $API/api/users.list -H "authorization: Bearer $BT")
BOTFLAG=$(echo "$UL" | python3 -c "import sys,json; d=json.load(sys.stdin); print([u['is_bot'] for u in d['members'] if u['id']=='$BOTUID'][0])")
[ "$BOTFLAG" = True ] && ok "users.list includes bot with is_bot" || fail "users.list" "$UL"

# ---- Events API ----
mkdir -p /tmp/qa
node "$(dirname "$0")/qa-slackbot.mjs" listen --port 8899 --secret "$SECRET" --events /tmp/qa/p4-events.jsonl &
BOTPID=$!
sleep 0.6
PA=$(curl -s -X PATCH "$API/v1/apps/$APPID" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"eventUrl":"http://127.0.0.1:8899/","eventTypes":["message.channels","message.im","app_mention","reaction_added","channel_created","channel_archive","member_joined_channel","member_left_channel"]}')
[ "$(echo "$PA" | j "['eventUrlVerified']")" = True ] && ok "url_verification challenge -> verified" || fail "url verify" "$PA"
grep -q '"type": *"url_verification"' /tmp/qa/p4-events.jsonl 2>/dev/null || grep -q 'url_verification' /tmp/qa/p4-events.jsonl \
  && ok "receiver saw the challenge" || fail "challenge receipt" "$(cat /tmp/qa/p4-events.jsonl)"

# owner posts -> message.channels event delivered, signed
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"event trigger s4-$TS <@$BOTUID>\",\"mentions\":[\"$BOTUID\"]}" > /dev/null
DEADLINE=$((SECONDS+8)); MSGEV=""; MENTEV=""
while [ $SECONDS -lt $DEADLINE ]; do
  MSGEV=$(grep -c '"type": *"message"' /tmp/qa/p4-events.jsonl 2>/dev/null || true)
  MENTEV=$(grep -c 'app_mention' /tmp/qa/p4-events.jsonl 2>/dev/null || true)
  [ "${MSGEV:-0}" -ge 1 ] && [ "${MENTEV:-0}" -ge 1 ] && break
  sleep 0.5
done
[ "${MSGEV:-0}" -ge 1 ] && ok "message.channels delivered to bot server" || fail "message event" "$(tail -2 /tmp/qa/p4-events.jsonl 2>/dev/null)"
[ "${MENTEV:-0}" -ge 1 ] && ok "app_mention delivered on <@bot> mention" || fail "app_mention" "$(tail -2 /tmp/qa/p4-events.jsonl 2>/dev/null)"
SIGBAD=$(grep -c '"sig_ok": *false' /tmp/qa/p4-events.jsonl 2>/dev/null || true)
[ "${SIGBAD:-0}" = 0 ] && ok "all deliveries signature-valid" || fail "signatures" "$SIGBAD bad"

# echo suppression: bot's own post produces no NEW message event for itself
BEFORE=$(grep -c 'event_callback' /tmp/qa/p4-events.jsonl)
curl -s -X POST $API/api/chat.postMessage -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"channel\":\"$GEN\",\"text\":\"echo check s4-$TS\"}" > /dev/null
sleep 2.5
AFTER=$(grep -c 'event_callback' /tmp/qa/p4-events.jsonl)
[ "$AFTER" = "$BEFORE" ] && ok "echo suppression (bot's own post -> no event)" || fail "echo suppression" "$BEFORE -> $AFTER"

# disabled app -> invalid_auth
curl -s -X POST "$API/v1/apps/$APPID/disable" -H "authorization: Bearer $AT" > /dev/null
DA=$(curl -s -X POST $API/api/auth.test -H "authorization: Bearer $BT" | j "['error']")
[ "$DA" = invalid_auth ] && ok "disabled app token -> invalid_auth" || fail "disabled auth" "$DA"
curl -s -X POST "$API/v1/apps/$APPID/enable" -H "authorization: Bearer $AT" > /dev/null

echo
echo "=== RESULT: $PASS passed, $FAIL failed ==="
exit $([ $FAIL = 0 ] && echo 0 || echo 1)
