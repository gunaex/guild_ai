import type { LocalSettings, SetLocalSettings, TFunction } from "./types";

interface OperationsSettingsTabProps {
  t: TFunction;
  form: LocalSettings;
  setForm: SetLocalSettings;
  persistSettings: (next: LocalSettings) => void;
}

export default function OperationsSettingsTab({ t, form, setForm, persistSettings }: OperationsSettingsTabProps) {
  const retention = Number.isFinite(Number(form.guildAiBackupRetentionDays))
    ? Number(form.guildAiBackupRetentionDays)
    : 14;

  return (
    <section
      className="space-y-5 rounded-xl p-5 sm:p-6"
      style={{ background: "var(--th-card-bg)", border: "1px solid var(--th-card-border)" }}
    >
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          {t({ ko: "Guild AI 운영", en: "Guild AI Operations", ja: "Guild AI 運用", zh: "Guild AI 运营" })}
        </h3>
        <p className="mt-1 text-xs leading-5" style={{ color: "var(--th-text-secondary)" }}>
          {t({
            ko: "자동 백업과 보관 정책을 설정합니다.",
            en: "Configure automatic backup and retention policy.",
            ja: "自動バックアップと保持ポリシーを設定します。",
            zh: "配置自动备份和保留策略。",
          })}
        </p>
      </div>

      <div
        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 sm:px-4"
        style={{ borderColor: "var(--th-card-border)", background: "var(--th-input-bg)" }}
      >
        <label className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
          {t({ ko: "자동 일일 백업", en: "Automatic daily backup", ja: "毎日の自動バックアップ", zh: "每日自动备份" })}
        </label>
        <button
          type="button"
          aria-pressed={form.guildAiBackupEnabled !== false}
          onClick={() => {
            const next = { ...form, guildAiBackupEnabled: !(form.guildAiBackupEnabled !== false) };
            setForm(next);
            persistSettings(next);
          }}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            form.guildAiBackupEnabled !== false ? "bg-blue-500" : "bg-slate-600"
          }`}
        >
          <div
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
              form.guildAiBackupEnabled !== false ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <div>
        <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
          {t({ ko: "백업 보관 기간", en: "Backup retention days", ja: "バックアップ保持日数", zh: "备份保留天数" })}
        </label>
        <input
          type="number"
          min={1}
          max={365}
          value={retention}
          onChange={(event) => {
            const value = Math.max(1, Math.min(365, Number(event.target.value) || 14));
            setForm({ ...form, guildAiBackupRetentionDays: value });
          }}
          onBlur={(event) => {
            const value = Math.max(1, Math.min(365, Number(event.target.value) || 14));
            persistSettings({ ...form, guildAiBackupRetentionDays: value });
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          style={{
            background: "var(--th-input-bg)",
            borderColor: "var(--th-input-border)",
            color: "var(--th-text-primary)",
          }}
        />
        <p className="mt-2 text-xs" style={{ color: "var(--th-text-secondary)" }}>
          {t({
            ko: "기본값은 14일입니다. 오래 보관할수록 디스크 사용량이 증가합니다.",
            en: "Default is 14 days. Longer retention uses more disk.",
            ja: "既定値は14日です。長く保持するとディスク使用量が増えます。",
            zh: "默认 14 天。保留时间越长，占用磁盘越多。",
          })}
        </p>
      </div>
    </section>
  );
}
