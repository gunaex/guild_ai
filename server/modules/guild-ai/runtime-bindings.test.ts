import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import {
  bootstrapGuildRuntimeWithOllama,
  chooseOllamaModel,
  listGuildRuntimeBindings,
  selectGuildRuntimeBindingForRole,
} from "./runtime-bindings.ts";

describe("Guild AI runtime bindings", () => {
  it("chooses runnable Ollama chat models before embedding models", () => {
    expect(chooseOllamaModel(["nomic-embed-text:latest", "llama3:latest"], null)).toBe("llama3:latest");
    expect(chooseOllamaModel(["gemma4:latest"], "gemma4:latest")).toBe("gemma4:latest");
  });

  it("bootstraps guild roles onto runtime agents and Local Ollama", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      const now = Date.UTC(2026, 0, 1);

      db.prepare(
        `INSERT INTO api_providers (
          id, name, type, base_url, enabled, models_cache, models_cached_at, created_at, updated_at
        ) VALUES (?, ?, 'ollama', ?, 1, ?, ?, ?, ?)`,
      ).run("ollama-1", "Local Ollama", "http://localhost:11434/v1", JSON.stringify(["nomic-embed-text:latest", "llama3:latest"]), now, now, now);

      db.prepare(
        `INSERT INTO guild_templates (
          guild_id, name, business_type, currency, template_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "E-Commerce Guild", "ecommerce", "USD", "{}", now, now);

      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "planning",
        "Planning",
        "Planning",
        "P",
        "#000",
      );
      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "dev",
        "Dev",
        "Dev",
        "D",
        "#000",
      );
      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "qa",
        "QA",
        "QA",
        "Q",
        "#000",
      );
      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "operations",
        "Ops",
        "Ops",
        "O",
        "#000",
      );

      const insertAgent = db.prepare(
        "INSERT INTO agents (id, name, department_id, role, cli_provider, created_at) VALUES (?, ?, ?, ?, 'codex', ?)",
      );
      insertAgent.run("sage", "Sage", "planning", "team_leader", now);
      insertAgent.run("aria", "Aria", "dev", "team_leader", now + 1);
      insertAgent.run("bolt", "Bolt", "dev", "senior", now + 2);
      insertAgent.run("hawk", "Hawk", "qa", "team_leader", now + 3);
      insertAgent.run("atlas", "Atlas", "operations", "team_leader", now + 4);
      insertAgent.run("clio", "Clio", "operations", "senior", now + 5);

      const insertRole = db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES ('ecom-001', ?, ?, ?, 'local')",
      );
      insertRole.run("pm-001", "pm", "PM");
      insertRole.run("tech-001", "techLead", "Tech");
      insertRole.run("worker-001", "worker", "Worker");
      insertRole.run("qa-001", "qa", "QA");
      insertRole.run("acct-001", "accounting", "Accounting");
      insertRole.run("hr-001", "hr", "HR");

      const result = bootstrapGuildRuntimeWithOllama(db, { guildId: "ecom-001", now });

      expect(result.model).toBe("llama3:latest");
      expect(result.bindings.map((binding) => [binding.guild_agent_id, binding.runtime_agent_id])).toEqual([
        ["pm-001", "sage"],
        ["tech-001", "aria"],
        ["worker-001", "bolt"],
        ["qa-001", "hawk"],
        ["hr-001", "clio"],
        ["acct-001", "atlas"],
      ]);
      expect(
        db.prepare("SELECT cli_provider, api_provider_id, api_model FROM agents WHERE id = 'sage'").get(),
      ).toEqual({ cli_provider: "api", api_provider_id: "ollama-1", api_model: "llama3:latest" });
    } finally {
      db.close();
    }
  });

  it("marks runtime bindings as limited only while the provider/model cooldown is active", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      const now = Date.UTC(2026, 0, 1);

      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "dev",
        "Dev",
        "Dev",
        "D",
        "#000",
      );
      db.prepare(
        `INSERT INTO api_providers (
          id, name, type, base_url, enabled, models_cache, models_cached_at, created_at, updated_at
        ) VALUES (?, ?, 'openai', ?, 1, ?, ?, ?, ?)`,
      ).run("provider-1", "OpenAI", "https://example.test/v1", JSON.stringify(["gpt-test"]), now, now, now);
      db.prepare(
        `INSERT INTO guild_templates (
          guild_id, name, business_type, currency, template_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "E-Commerce Guild", "ecommerce", "USD", "{}", now, now);
      db.prepare(
        "INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, created_at) VALUES (?, ?, ?, ?, 'api', ?, ?, ?)",
      ).run("worker-runtime", "Worker Runtime", "dev", "senior", "provider-1", "gpt-test", now);
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)",
      ).run("ecom-001", "worker-001", "worker", "Worker", "gpt-test");
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run("ecom-001", "worker-001", "worker-runtime", "provider-1", "gpt-test", now, now);

      expect(listGuildRuntimeBindings(db, "ecom-001")[0].availability_status).toBe("available");

      db.prepare(
        `INSERT INTO guild_ai_limit_events (
          guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "worker-runtime", "provider-1", "openai", "gpt-test", "rate_limit", "cooldown", Date.now() + 60_000, now);

      const limited = listGuildRuntimeBindings(db, "ecom-001")[0];
      expect(limited.availability_status).toBe("limited");
      expect(limited.active_limit?.limitType).toBe("rate_limit");

      db.prepare("UPDATE guild_ai_limit_events SET active_until = ?, recovered_at = NULL").run(Date.now() - 1_000);
      const recovered = listGuildRuntimeBindings(db, "ecom-001")[0];
      expect(recovered.availability_status).toBe("available");
      expect(recovered.active_limit).toBeNull();
      expect(
        (db.prepare("SELECT recovered_at FROM guild_ai_limit_events LIMIT 1").get() as { recovered_at: number | null })
          .recovered_at,
      ).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("selects an available same-role binding before a limited binding", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      const now = Date.UTC(2026, 0, 1);
      db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
        "dev",
        "Dev",
        "Dev",
        "D",
        "#000",
      );
      db.prepare(
        "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("ecom-001", "E-Commerce Guild", "ecommerce", "USD", "{}", now, now);
      db.prepare(
        "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, 'openai', ?, 1, ?, ?)",
      ).run("provider-1", "Primary", "https://primary.test/v1", now, now);
      db.prepare(
        "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, 'openai', ?, 1, ?, ?)",
      ).run("provider-2", "Backup", "https://backup.test/v1", now, now);
      db.prepare(
        "INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, created_at) VALUES (?, ?, ?, ?, 'api', ?, ?, ?)",
      ).run("primary-worker", "Primary Worker", "dev", "senior", "provider-1", "gpt-primary", now);
      db.prepare(
        "INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, created_at) VALUES (?, ?, ?, ?, 'api', ?, ?, ?)",
      ).run("backup-worker", "Backup Worker", "dev", "senior", "provider-2", "gpt-backup", now);
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, 'worker', ?, ?)",
      ).run("ecom-001", "worker-primary", "Worker Primary", "gpt-primary");
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, 'worker', ?, ?)",
      ).run("ecom-001", "worker-backup", "Worker Backup", "gpt-backup");
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run("ecom-001", "worker-primary", "primary-worker", "provider-1", "gpt-primary", now, now + 2);
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run("ecom-001", "worker-backup", "backup-worker", "provider-2", "gpt-backup", now, now + 1);
      db.prepare(
        `INSERT INTO guild_ai_limit_events (
          guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "primary-worker", "provider-1", "openai", "gpt-primary", "rate_limit", "cooldown", Date.now() + 60_000, now);

      expect(selectGuildRuntimeBindingForRole(db, "ecom-001", "worker")?.runtime_agent_id).toBe("backup-worker");
    } finally {
      db.close();
    }
  });
});
