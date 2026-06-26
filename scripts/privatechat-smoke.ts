// End-to-end DB roundtrip for the private chat store. Picks the newest project
// as the space, registers two users, logs one in, searches, starts a
// conversation, sends messages, and pages them with the cursor.
// Run: npm run privatechat:smoke

import { desc } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { hashPassword, normalizeUsername } from "../lib/chat/identity";
import { encodeCursor } from "../lib/chat/cursor";
import {
  createChatSession, getChatSession, getOrCreateConversation, insertMessage,
  listConversations, listMessagesSince, registerChatUser, searchChatUsers,
} from "../lib/chat/store";

function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(`SMOKE FAIL: ${msg}`); }

async function main() {
  const proj = (await db.select({ id: schema.projects.id }).from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(1))[0];
  assert(proj, "need at least one project in the dev DB");
  const projectId = proj.id;
  const stamp = Date.now().toString(36);
  const uA = normalizeUsername(`smokeA${stamp}`);
  const uB = normalizeUsername(`smokeB${stamp}`);
  const pw = await hashPassword("hunter22");

  const ra = await registerChatUser(projectId, uA, pw);
  const rb = await registerChatUser(projectId, uB, pw);
  assert("id" in ra && "id" in rb, "register returned ids");
  const aId = (ra as { id: string }).id;
  const bId = (rb as { id: string }).id;

  const dup = await registerChatUser(projectId, uA, pw);
  assert("error" in dup && dup.error === "taken", "duplicate username rejected");

  const raw = await createChatSession(projectId, aId);
  const sess = await getChatSession(raw);
  assert(sess && sess.chatUserId === aId, "session resolves to user A");

  const found = await searchChatUsers(projectId, `smokeb${stamp}`.slice(0, 6), aId);
  assert(found.some((u) => u.id === bId), "search finds user B, excludes self");

  const convo = await getOrCreateConversation(projectId, aId, bId);
  const convo2 = await getOrCreateConversation(projectId, bId, aId);
  assert(convo.id === convo2.id, "conversation pair is order-independent (one row)");

  const m1 = await insertMessage(convo.id, aId, "hola");
  await insertMessage(convo.id, bId, "qué tal");
  const firstPage = await listMessagesSince(convo.id, null);
  assert(firstPage.length === 2 && firstPage[0].body === "hola", "messages ordered ascending");
  const since = await listMessagesSince(convo.id, encodeCursor(m1));
  assert(since.length === 1 && since[0].body === "qué tal", "cursor returns only newer messages");

  const convos = await listConversations(projectId, aId);
  assert(convos.some((c) => c.id === convo.id && c.otherUsername === uB), "conversation list shows the other user");

  console.log("private chat smoke OK");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
