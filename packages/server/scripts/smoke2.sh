#!/bin/bash
# Flow phase-2 REST smoke test: DMs, reactions, files, membership, notify
# levels, mentions/notifications, profiles. Requires the server running.
set -u
API=http://127.0.0.1:8787
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1  -- $2"; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }
u() { python3 -c "import uuid; print(uuid.uuid4())"; }

TS=$(date +%s)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

reg() { # email name -> "token id"
  local R
  R=$(curl -s -X POST $API/v1/auth/register -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"password123\",\"displayName\":\"$2\",\"autoVerify\":true}")
  echo "$(echo "$R" | j "['token']") $(echo "$R" | j "['user']['id']")"
}

read -r AT AID <<< "$(reg "alice.$TS@p2.test" "Alice P2")"
read -r BT BID <<< "$(reg "bob.$TS@p2.test" "Bob P2")"
read -r CT CID <<< "$(reg "carol.$TS@p2.test" "Carol P2")"
read -r DT DID <<< "$(reg "dave.$TS@p2.test" "Dave P2")"   # never joins the workspace

WS=$(curl -s -X POST $API/v1/workspaces -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"name\":\"P2 $TS\",\"slug\":\"p2-$TS\"}" | j "['id']")
for T in "$BT" "$CT"; do
  EMAIL=$(curl -s $API/v1/me -H "authorization: Bearer $T" | j "['email']")
  IURL=$(curl -s -X POST "$API/v1/workspaces/$WS/invites" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\"}" | j "['inviteUrl']")
  curl -s -X POST $API/v1/invites/accept -H "authorization: Bearer $T" -H 'content-type: application/json' \
    -d "{\"token\":\"${IURL##*/}\"}" > /dev/null
done
GEN=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" | j "['channels'][0]['id']")
[ -n "$WS" ] && [ -n "$GEN" ] && ok "setup: workspace + 3 members" || fail "setup" "$WS/$GEN"

# ===================== 1. DMs =====================
DM=$(curl -s -X POST "$API/v1/workspaces/$WS/dms" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"userIds\":[\"$BID\"]}")
DMID=$(echo "$DM" | j "['id']"); DMKIND=$(echo "$DM" | j "['kind']")
DMPRIV=$(echo "$DM" | j "['isPrivate']"); DMNAME=$(echo "$DM" | j "['name']")
NMEM=$(echo "$DM" | j "['memberIds'].__len__()")
[ "$DMKIND" = dm ] && [ "$DMPRIV" = True ] && [ "$DMNAME" = None ] && [ "$NMEM" = 2 ] \
  && ok "1:1 DM created (kind=dm, private, unnamed, 2 members)" || fail "dm create" "$DM"

DMID2=$(curl -s -X POST "$API/v1/workspaces/$WS/dms" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"userIds\":[\"$AID\"]}" | j "['id']")
[ "$DMID2" = "$DMID" ] && ok "DM upsert: same channel from either side" || fail "dm upsert" "$DMID2 vs $DMID"

GDM=$(curl -s -X POST "$API/v1/workspaces/$WS/dms" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"userIds\":[\"$BID\",\"$CID\"]}")
GDMID=$(echo "$GDM" | j "['id']"); GKIND=$(echo "$GDM" | j "['kind']")
[ "$GKIND" = group_dm ] && [ "$GDMID" != "$DMID" ] && ok "group DM is a distinct channel (kind=group_dm)" || fail "group dm" "$GDM"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WS/dms" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"userIds\":[\"$DID\"]}")
[ "$CODE" = 400 ] && ok "DM to non-workspace-member -> 400" || fail "dm outsider" "got $CODE"

# bob sees the DM in his channel list with memberIds
BL=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT")
BDM=$(echo "$BL" | python3 -c "import sys,json; cs=[c for c in json.load(sys.stdin)['channels'] if c['id']=='$DMID']; print(len(cs) and len(cs[0]['memberIds']))")
[ "$BDM" = 2 ] && ok "DM appears in member's channel list with memberIds" || fail "dm list" "$BL"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$DMID/leave" -H "authorization: Bearer $BT")
[ "$CODE" = 400 ] && ok "leave 1:1 DM -> 400" || fail "leave dm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GDMID/leave" -H "authorization: Bearer $CT")
[ "$CODE" = 200 ] && ok "leave group DM -> ok" || fail "leave gdm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GDMID/members" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d "{\"userId\":\"$CID\"}")
[ "$CODE" = 400 ] && ok "add member to DM -> 400 (membership fixed)" || fail "dm add member" "got $CODE"

# DM message -> kind=1 notification for bob
DMMSG=$(curl -s -X POST "$API/v1/channels/$DMID/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"dm hello bob\"}" | j "['id']")
BN=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $BT")
BNK=$(echo "$BN" | j "['notifications'][0]['kind']"); BNM=$(echo "$BN" | j "['notifications'][0]['message']['body']")
BNU=$(echo "$BN" | j "['unreadCount']"); BNID=$(echo "$BN" | j "['notifications'][0]['id']")
[ "$BNK" = 1 ] && [ "$BNM" = "dm hello bob" ] && [ "$BNU" = 1 ] && ok "DM message -> kind=1 notification with message preview" || fail "dm notification" "$BN"

curl -s -X POST "$API/v1/me/notifications/read" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"upToId\":\"$BNID\"}" > /dev/null
BNU2=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $BT" | j "['unreadCount']")
[ "$BNU2" = 0 ] && ok "notifications/read clears unread count" || fail "notif read" "$BNU2"

# ===================== 2. Reactions =====================
M1=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"react to me\"}" | j "['id']")
EMOJI=$(python3 -c "import urllib.parse; print(urllib.parse.quote('👍'))")
R1=$(curl -s -X PUT "$API/v1/messages/$M1/reactions/$EMOJI" -H "authorization: Bearer $BT")
C1=$(echo "$R1" | j "['reactions'][0]['count']")
[ "$C1" = 1 ] && ok "add reaction 👍" || fail "add reaction" "$R1"
C2=$(curl -s -X PUT "$API/v1/messages/$M1/reactions/$EMOJI" -H "authorization: Bearer $BT" | j "['reactions'][0]['count']")
[ "$C2" = 1 ] && ok "reaction add is idempotent" || fail "reaction idempotent" "$C2"
C3=$(curl -s -X PUT "$API/v1/messages/$M1/reactions/$EMOJI" -H "authorization: Bearer $AT" | j "['reactions'][0]['count']")
[ "$C3" = 2 ] && ok "second user -> count=2" || fail "reaction count" "$C3"

RAGG=$(curl -s "$API/v1/channels/$GEN/messages?limit=5" -H "authorization: Bearer $AT" | \
  python3 -c "import sys,json; m=[x for x in json.load(sys.stdin)['messages'] if x['id']=='$M1'][0]; r=m['reactions'][0]; print(r['emoji'], r['count'], len(r['userIds']))")
[ "$RAGG" = "👍 2 2" ] && ok "message page carries aggregated reactions" || fail "reaction agg" "$RAGG"

C4=$(curl -s -X DELETE "$API/v1/messages/$M1/reactions/$EMOJI" -H "authorization: Bearer $BT" | j "['reactions'][0]['count']")
[ "$C4" = 1 ] && ok "remove reaction -> count=1" || fail "remove reaction" "$C4"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/v1/messages/$M1/reactions/abc" -H "authorization: Bearer $BT")
[ "$CODE" = 400 ] && ok "non-emoji reaction -> 400" || fail "emoji validation" "got $CODE"

# ===================== 3. Files =====================
PNG="$TMP/red.png"
python3 -c "import base64,sys; open('$PNG','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))"
F1=$(curl -s -X POST "$API/v1/workspaces/$WS/files" -H "authorization: Bearer $AT" -F "file=@$PNG;type=image/png")
FID=$(echo "$F1" | j "['id']"); FW=$(echo "$F1" | j "['width']"); FTH=$(echo "$F1" | j "['hasThumb']")
[ -n "$FID" ] && [ "$FW" = 1 ] && [ "$FTH" = True ] && ok "image upload: dims + thumbnail recorded" || fail "upload" "$F1"

# unattached file: only the uploader can fetch
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/files/$FID" -H "authorization: Bearer $BT")
[ "$CODE" = 404 ] && ok "unattached file hidden from others -> 404" || fail "unattached access" "got $CODE"

FM=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"see attached\",\"fileIds\":[\"$FID\"]}")
FMF=$(echo "$FM" | j "['files'][0]['id']")
[ "$FMF" = "$FID" ] && ok "message send with fileIds -> files on DTO" || fail "attach" "$FM"

curl -s "$API/v1/files/$FID" -H "authorization: Bearer $BT" -o "$TMP/dl.png" -D "$TMP/hdrs"
cmp -s "$PNG" "$TMP/dl.png" && ok "attached file downloads byte-identical for co-member" || fail "download" "$(ls -l $PNG $TMP/dl.png)"
grep -qi "content-disposition: attachment" "$TMP/hdrs" && grep -qi "x-content-type-options: nosniff" "$TMP/hdrs" \
  && ok "download headers: attachment + nosniff" || fail "download headers" "$(cat $TMP/hdrs)"

TCODE=$(curl -s -o "$TMP/thumb.webp" -w '%{http_code}' "$API/v1/files/$FID/thumb" -H "authorization: Bearer $BT")
TMIME=$(file -b --mime-type "$TMP/thumb.webp")
[ "$TCODE" = 200 ] && [ "$TMIME" = "image/webp" ] && ok "thumbnail serves as webp" || fail "thumb" "$TCODE $TMIME"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/files/$FID" -H "authorization: Bearer $DT")
[ "$CODE" = 404 ] && ok "outsider file access -> 404" || fail "outsider file" "got $CODE"

# encryption at rest: stored blob must not contain the PNG magic
BLOB=$(find "${FLOW_FILE_DIR:-$(dirname "$0")/../.files}/files" -name "$FID" 2>/dev/null | head -1)
if [ -n "$BLOB" ]; then
  python3 -c "import sys; d=open('$BLOB','rb').read(); sys.exit(0 if b'\x89PNG' not in d else 1)" \
    && ok "file blob is ciphertext on disk (no PNG magic)" || fail "file encryption" "plaintext PNG found in $BLOB"
else
  fail "file encryption" "stored blob not found"
fi

# oversize upload rejected
python3 -c "open('$TMP/big.bin','wb').write(b'\0'*(21*1024*1024))"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WS/files" -H "authorization: Bearer $AT" -F "file=@$TMP/big.bin;type=application/octet-stream")
[ "$CODE" = 413 ] || [ "$CODE" = 400 ] && ok "oversize upload rejected ($CODE)" || fail "oversize" "got $CODE"

# ===================== 4. Membership management =====================
PRIV=$(curl -s -X POST "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"warroom","isPrivate":true}' | j "['id']")
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/members" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d "{\"userId\":\"$CID\"}")
[ "$CODE" = 404 ] && ok "non-member invite to private -> 404" || fail "priv invite perm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/members" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d "{\"userId\":\"$BID\"}")
[ "$CODE" = 201 ] && ok "channel member invites bob to private" || fail "priv invite" "got $CODE"
SEEN=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $BT" | \
  python3 -c "import sys,json; print(any(c['id']=='$PRIV' for c in json.load(sys.stdin)['channels']))")
[ "$SEEN" = True ] && ok "invited member now sees private channel" || fail "priv visible" "$SEEN"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/members" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d "{\"userId\":\"$CID\"}")
[ "$CODE" = 201 ] && ok "private-channel member can invite others" || fail "member invites" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/channels/$PRIV/members/$AID" -H "authorization: Bearer $BT")
[ "$CODE" = 403 ] && ok "member removing someone else -> 403" || fail "remove perm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/channels/$PRIV/members/$CID" -H "authorization: Bearer $AT")
[ "$CODE" = 200 ] && ok "owner removes member" || fail "owner remove" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/leave" -H "authorization: Bearer $BT")
[ "$CODE" = 200 ] && ok "leave channel" || fail "leave" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GEN/leave" -H "authorization: Bearer $BT")
[ "$CODE" = 400 ] && ok "leave #general -> 400" || fail "leave general" "got $CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/archive" -H "authorization: Bearer $CT")
[ "$CODE" = 404 ] && ok "outsider archive -> 404" || fail "archive perm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/archive" -H "authorization: Bearer $AT")
[ "$CODE" = 200 ] && ok "creator archives channel" || fail "archive" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$PRIV/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d "{\"clientMsgId\":\"$(u)\",\"body\":\"x\"}")
[ "$CODE" = 400 ] && ok "post to archived -> 400" || fail "archived post" "got $CODE"
GONE=$(curl -s "$API/v1/workspaces/$WS/channels" -H "authorization: Bearer $AT" | \
  python3 -c "import sys,json; print(any(c['id']=='$PRIV' for c in json.load(sys.stdin)['channels']))")
[ "$GONE" = False ] && ok "archived channel hidden from list" || fail "archived hidden" "$GONE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GEN/archive" -H "authorization: Bearer $AT")
[ "$CODE" = 400 ] && ok "archive #general -> 400" || fail "archive general" "got $CODE"

# ===================== 5. Mentions + notify levels =====================
# default level (mentions): @bob mention -> kind=0
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"hey <@$BID> look\",\"mentions\":[\"$BID\"]}" > /dev/null
NK=$(curl -s "$API/v1/me/notifications?limit=1" -H "authorization: Bearer $BT" | j "['notifications'][0]['kind']")
[ "$NK" = 0 ] && ok "@mention -> kind=0 notification" || fail "mention notif" "$NK"

# mention of non-workspace member -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"hi <@$DID>\",\"mentions\":[\"$DID\"]}")
[ "$CODE" = 400 ] && ok "mention of non-member -> 400" || fail "bad mention" "got $CODE"

# group mention <!channel> notifies members (kind=0), respecting mute
BB4=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $BT" | j "['unreadCount']")
CB4=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $CT" | j "['unreadCount']")
curl -s -X PUT "$API/v1/channels/$GEN/notify" -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"level":0}' > /dev/null
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"<!channel> standup time\"}" > /dev/null
BAF=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $BT" | j "['unreadCount']")
CAF=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $CT" | j "['unreadCount']")
[ "$BAF" = "$((BB4+1))" ] && ok "<!channel> notifies channel members" || fail "channel mention" "$BB4 -> $BAF"
[ "$CAF" = "$CB4" ] && ok "muted member gets no <!channel> notification" || fail "mute suppresses" "$CB4 -> $CAF"

# muted member: even direct @mention suppressed
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"psst <@$CID>\",\"mentions\":[\"$CID\"]}" > /dev/null
CAF2=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $CT" | j "['unreadCount']")
[ "$CAF2" = "$CB4" ] && ok "mute suppresses direct @mention" || fail "mute mention" "$CB4 -> $CAF2"

# notify_level=all: plain message -> kind=3
curl -s -X PUT "$API/v1/channels/$GEN/notify" -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"level":2}' > /dev/null
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"plain chatter\"}" > /dev/null
NK3=$(curl -s "$API/v1/me/notifications?limit=1" -H "authorization: Bearer $CT" | j "['notifications'][0]['kind']")
[ "$NK3" = 3 ] && ok "notify_level=all -> kind=3 on plain message" || fail "level all" "$NK3"
curl -s -X PUT "$API/v1/channels/$GEN/notify" -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"level":1}' > /dev/null

# thread reply notifies the root author (kind=2)
ROOT=$(curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"thread root\"}" | j "['id']")
curl -s -X POST "$API/v1/channels/$GEN/messages" -H "authorization: Bearer $BT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"a reply\",\"threadRootId\":\"$ROOT\"}" > /dev/null
AK=$(curl -s "$API/v1/me/notifications?limit=1" -H "authorization: Bearer $AT" | j "['notifications'][0]['kind']")
[ "$AK" = 2 ] && ok "thread reply -> kind=2 for root author" || fail "thread notif" "$AK"

# DM beats mention: alice DMs bob mentioning him -> single kind=1
BNB4=$(curl -s "$API/v1/me/notifications" -H "authorization: Bearer $BT" | j "['unreadCount']")
curl -s -X POST "$API/v1/channels/$DMID/messages" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"clientMsgId\":\"$(u)\",\"body\":\"dm with <@$BID>\",\"mentions\":[\"$BID\"]}" > /dev/null
BNA=$(curl -s "$API/v1/me/notifications?limit=1" -H "authorization: Bearer $BT")
BNAK=$(echo "$BNA" | j "['notifications'][0]['kind']"); BNAU=$(echo "$BNA" | j "['unreadCount']")
[ "$BNAK" = 1 ] && [ "$BNAU" = "$((BNB4+1))" ] && ok "DM+mention -> one notification, kind=1 (dm wins)" || fail "dm precedence" "$BNA"

# ===================== 6. Profiles =====================
PM=$(curl -s -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"displayName":"Alice Prime","timezone":"America/Los_Angeles"}')
PMN=$(echo "$PM" | j "['displayName']"); PMT=$(echo "$PM" | j "['timezone']")
[ "$PMN" = "Alice Prime" ] && [ "$PMT" = "America/Los_Angeles" ] && ok "PATCH /me name + timezone" || fail "patch me" "$PM"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"timezone":"Not/AZone"}')
[ "$CODE" = 400 ] && ok "invalid timezone -> 400" || fail "bad tz" "got $CODE"

PU=$(curl -s "$API/v1/users/$AID" -H "authorization: Bearer $BT")
PUN=$(echo "$PU" | j "['displayName']"); PUT2=$(echo "$PU" | j "['timezone']"); PUE=$(echo "$PU" | j "['email']")
[ "$PUN" = "Alice Prime" ] && [ "$PUT2" = "America/Los_Angeles" ] && [ -n "$PUE" ] && ok "co-member fetches profile" || fail "get user" "$PU"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/users/$AID" -H "authorization: Bearer $DT")
[ "$CODE" = 404 ] && ok "stranger profile fetch -> 404" || fail "stranger profile" "got $CODE"

# workspace sidebar color (phase 3.5): owner sets preset, member forbidden, invalid id rejected
WC=$(curl -s -X PATCH "$API/v1/workspaces/$WS" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"sidebarColor":"ocean"}' | j "['sidebarColor']")
[ "$WC" = "ocean" ] && ok "owner sets workspace sidebar color" || fail "set color" "$WC"
WCL=$(curl -s "$API/v1/me/workspaces" -H "authorization: Bearer $BT" | \
  python3 -c "import sys,json; print([w['sidebarColor'] for w in json.load(sys.stdin)['workspaces'] if w['id']=='$WS'][0])")
[ "$WCL" = "ocean" ] && ok "color visible to members on workspace list" || fail "color list" "$WCL"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/workspaces/$WS" -H "authorization: Bearer $BT" -H 'content-type: application/json' -d '{"sidebarColor":"plum"}')
[ "$CODE" = 403 ] && ok "member set color -> 403" || fail "color perm" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/workspaces/$WS" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"sidebarColor":"hotpink"}')
[ "$CODE" = 400 ] && ok "invalid color id -> 400" || fail "color validation" "got $CODE"

# status (design 3a): set both together, propagates to profile fetch, clears with ''
SS=$(curl -s -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"statusEmoji":"🎧","statusText":"Focusing"}')
SSE=$(echo "$SS" | j "['statusEmoji']"); SST=$(echo "$SS" | j "['statusText']")
[ "$SSE" = "🎧" ] && [ "$SST" = "Focusing" ] && ok "set status (emoji + text)" || fail "set status" "$SS"
PS=$(curl -s "$API/v1/users/$AID" -H "authorization: Bearer $BT" | j "['statusText']")
[ "$PS" = "Focusing" ] && ok "status visible on profile fetch" || fail "status profile" "$PS"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"statusEmoji":"🎧"}')
[ "$CODE" = 400 ] && ok "status fields must be set together -> 400" || fail "status pair" "got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"statusEmoji":"abc","statusText":"x"}')
[ "$CODE" = 400 ] && ok "non-emoji status -> 400" || fail "status emoji" "got $CODE"
CS=$(curl -s -X PATCH "$API/v1/me" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"statusEmoji":"","statusText":""}' | j "['statusEmoji']")
[ "$CS" = "" ] && ok "clear status with empty strings" || fail "clear status" "$CS"

AV=$(curl -s -X POST "$API/v1/me/avatar" -H "authorization: Bearer $AT" -F "file=@$PNG;type=image/png")
AVURL=$(echo "$AV" | j "['avatarUrl']")
case "$AVURL" in /v1/avatars/*) ok "avatar upload sets avatarUrl" ;; *) fail "avatar" "$AV" ;; esac
ACODE=$(curl -s -o "$TMP/av.webp" -w '%{http_code}' "$API$AVURL" -H "authorization: Bearer $BT")
AMIME=$(file -b --mime-type "$TMP/av.webp")
[ "$ACODE" = 200 ] && [ "$AMIME" = "image/webp" ] && ok "avatar serves as webp" || fail "avatar fetch" "$ACODE $AMIME"

echo
echo "=== RESULT: $PASS passed, $FAIL failed ==="
exit $([ $FAIL = 0 ] && echo 0 || echo 1)
