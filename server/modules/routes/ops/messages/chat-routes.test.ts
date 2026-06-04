import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { applyBaseSchema } from "../../../bootstrap/schema/base-schema.ts";
import { clearAgentConversation } from "./chat-routes.ts";

function createHarness() {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);

  const broadcast = vi.fn();
  const resetDirectChatState = vi.fn(() => ({ clearedPendingProjectBinding: true }));

  return { db, broadcast, resetDirectChatState };
}

describe("chat message routes", () => {
  it("clears pending direct-chat project binding state when an agent conversation is deleted", async () => {
    const { db, broadcast, resetDirectChatState } = createHarness();
    try {
      db.prepare(
        `INSERT INTO messages (
          id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, created_at
        ) VALUES (?, 'ceo', NULL, 'agent', ?, ?, 'chat', ?)`,
      ).run("msg-1", "agent-1", "hello", 1);

      const result = clearAgentConversation({ app: null, db, broadcast } as never, "agent-1", resetDirectChatState);

      expect(resetDirectChatState).toHaveBeenCalledWith("agent-1");
      expect(result).toEqual({
        deleted: 1,
        clearedPendingProjectBinding: true,
      });
      expect(broadcast).toHaveBeenCalledWith("messages_cleared", { scope: "agent", agent_id: "agent-1" });
    } finally {
      db.close();
    }
  });
});
