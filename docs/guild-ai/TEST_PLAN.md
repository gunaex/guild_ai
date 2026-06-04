# Guild AI Local-first MVP Test Plan

สถานะเป้าหมายปัจจุบัน:

- Local-first MVP: 100%
- Full Guild AI vision: 100%
- Default guild: `ecom-001`
- Local API default: `http://127.0.0.1:8790`
- Local UI default: Vite จะเลือกพอร์ตว่าง เช่น `http://127.0.0.1:8802`

เอกสารนี้คือแผนทดสอบแบบ step-by-step สำหรับตรวจว่า Guild AI ที่เราสร้างไว้ใช้งานได้จริงบนเครื่อง local โดยยังไม่ต้องเปิด server ขึ้น internet

## 1. เตรียมเครื่อง

เข้า workspace fork:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
```

ตรวจ Node.js:

```bash
node --version
npm --version
```

คาดหวัง:

- Node.js ใช้งานได้
- dependencies ถูกติดตั้งแล้ว
- ถ้ายังไม่ติดตั้ง ให้รัน `npm install --package-lock=false`

## 2. เตรียม Local AI ด้วย Ollama

เปิด Ollama:

```bash
ollama serve
```

อีก terminal หนึ่ง ตรวจ model:

```bash
ollama list
```

ถ้ายังไม่มี model สำหรับ smoke test:

```bash
ollama pull llama3.1:8b
```

คาดหวัง:

- `ollama serve` ทำงานอยู่
- `ollama list` เห็น model อย่างน้อย 1 ตัว
- Guild AI สามารถ bind local runtime ได้

## 3. Start Guild AI Runtime

ใช้คำสั่งนี้แทน `npm start` เพราะ upstream มี Remotion prestart ที่ยังไม่เหมาะกับ fork runtime:

```bash
npm run dev:local
```

หรือถ้าต้องการเปิด server ตรง:

```bash
./node_modules/.bin/tsx server/index.ts
```

คาดหวัง:

- API เปิดที่ `http://127.0.0.1:8790`
- Web UI เปิดที่พอร์ต Vite ที่แสดงใน terminal
- อย่า expose dev server ขึ้น internet โดยตรง

## 4. เปิดหน้า UI

เปิด browser ไปที่ URL ที่ terminal แสดง เช่น:

```text
http://127.0.0.1:8802
```

จากนั้นเลือกเมนู:

```text
Guild AI
```

คาดหวัง:

- เห็นหน้า Guild AI panel
- เห็น metrics เช่น capability level, pending upgrades, net income
- เห็นส่วน self-improvement, accounting, runtime, smoke workflow
- เห็น Final launch readiness
- เห็น Daily PM report และปุ่ม `Generate now`
- เห็น HR governance และปุ่ม `Score today`
- เห็น L2/vector memory status

## 5. Health Check

เปิด terminal ใหม่ แล้วรัน:

```bash
curl -s http://127.0.0.1:8790/api/auth/session
```

คาดหวัง:

- server ตอบ session JSON
- ไม่มี network error

จากนั้นใช้ command acceptance หลัก:

```bash
npm run guild:mvp-check
```

แล้วรัน doctor command เพื่อดู readiness, limits, report, และ Ollama ในที่เดียว:

```bash
npm run guild:doctor
```

คาดหวัง:

- ไม่มี `FAIL`
- เห็น multi-guild template check
- เห็น vector memory check
- เห็น audit replay check

คาดหวัง:

```text
Guild AI local MVP check: PASS (10/10)
```

ถ้า API ไม่ได้ใช้ port default:

```bash
GUILD_AI_BASE_URL=http://127.0.0.1:8790 npm run guild:mvp-check
```

## 6. ทดสอบ Guild Template

ในหน้า Guild AI:

1. กดหรือเปิดส่วน template/default guild
2. ตรวจว่า guild `ecom-001` โหลดได้
3. ตรวจว่ามี roles หลัก เช่น PM, Tech Lead, Worker, QA, HR, Accounting

คาดหวัง:

- Template list มี guild อย่างน้อย 1 ตัว
- Detail ของ `ecom-001` เปิดได้
- Runtime bindings พร้อมสำหรับ roles หลัก

API ที่เกี่ยวข้อง:

```text
GET /api/guild-ai/templates
GET /api/guild-ai/templates/ecom-001
```

## 7. ทดสอบ Local Ollama Runtime Binding

ในหน้า Guild AI ให้ทำตามลำดับ:

1. กด `Bootstrap Ollama runtime`
2. ตรวจ runtime bindings
3. ตรวจว่า role สำคัญถูก bind กับ provider/model local

คาดหวัง:

- Roles หลักมี runtime binding
- ไม่มี active model limit blocking MVP
- ถ้า model ใดติด limit ระบบต้องหยุดเฉพาะ model/provider นั้น และ provider อื่นยังทำงานต่อได้

## 8. ทดสอบ Smoke Workflow

ในหน้า Guild AI ให้ทำตามลำดับ:

1. กด `Run smoke`
2. กด `Stage task smoke`
3. กด `Run staged smoke`
4. กด `Load latest smoke`
5. กด `Refresh artifacts`
6. ตรวจ `SMOKE_RESULT.md`
7. เมื่อ evidence พร้อมแล้วจึง approve ด้วย `qa_pass`

คาดหวัง:

- Task ถูกสร้างจริง
- Worker ทำงานและสร้าง artifact จริง
- QA approval ถูก block ถ้า evidence ยังไม่พร้อม
- เมื่อมี `SMOKE_RESULT.md` ที่ completed แล้ว `qa_pass` ผ่านได้
- Task สุดท้ายอยู่สถานะ `done` หรืออย่างน้อยอยู่ขั้น QA review พร้อม evidence

## 9. ทดสอบ Accounting

ในหน้า Guild AI ตรวจ:

1. Chart of accounts
2. P&L summary
3. Latest journal entries
4. Token usage journal
5. Revenue/service income journal ถ้ามีการ record รายได้

คาดหวัง:

- มีบัญชีครบ 5 หมวด: asset, liability, equity, revenue, expense
- Token usage ลง double-entry journal ได้
- P&L คำนวณ net income ได้
- ค่า net income เป็นตัวเลข finite ไม่พัง

API ที่เกี่ยวข้อง:

```text
GET /api/guild-ai/accounting/ecom-001
GET /api/guild-ai/accounting/ecom-001/pnl
GET /api/guild-ai/accounting/ecom-001/journal
GET /api/guild-ai/accounting/ecom-001/accounts
POST /api/guild-ai/accounting/token-usage
```

## 10. ทดสอบ Self-improvement Governance

ในหน้า Guild AI:

1. สร้าง upgrade proposal
2. เปิด event history ของ proposal
3. เพิ่ม SGM Advisor advice
4. ทดลอง decision เช่น `approve`, `reject`, `sandbox`, `needs_info`

คาดหวัง:

- Proposal ถูกสร้างได้
- Event history แสดงได้
- Human approval decision ถูกบันทึก
- SGM Advisor advice ถูกบันทึก
- ระบบยังไม่ auto-upgrade ตัวเองแบบไร้การอนุมัติ

API ที่เกี่ยวข้อง:

```text
GET /api/guild-ai/capabilities/ecom-001
GET /api/guild-ai/upgrades/ecom-001
POST /api/guild-ai/upgrades/proposals
POST /api/guild-ai/upgrades/:proposalId/decision
GET /api/guild-ai/upgrades/:proposalId/events
GET /api/guild-ai/advice/ecom-001
POST /api/guild-ai/advice
```

## 11. ทดสอบ Model Limit Governance

กรณี AI provider/model ติด limit:

1. ตรวจหน้า model/provider limit
2. ยืนยันว่าเฉพาะ model ที่ติด limit ถูก pause
3. ยืนยันว่า provider/model อื่นยังทำงานต่อ
4. เมื่อ reset limit แล้ว ระบบต้องกลับมาทำงานอัตโนมัติ
5. เก็บข้อมูล limit เพื่อใช้คุมต้นทุนและ evaluate provider

คาดหวัง:

- Limit ไม่ทำให้ทั้ง guild หยุด
- มีข้อมูลว่า model ไหนติด limit, ติดเมื่อไหร่, reset เมื่อไหร่
- Acceptance checker ต้องเห็น active limit เป็น `0` สำหรับ MVP pass

## 12. ทดสอบ Build และ Test Suite

รัน:

```bash
npm run build
npm run test:api
npm run test:web
```

คาดหวัง:

- Build ผ่าน
- API tests ผ่าน
- Web tests ผ่าน

ผลล่าสุดที่เคย verify:

- `npm run guild:mvp-check`: 10/10 gates passed
- `npm run build`: passed
- `npm run test:api`: 62 files / 254 tests passed
- `npm run test:web`: 25 files / 76 tests passed

## 13. ทดสอบ Main Scaffold และ Overlay

กลับไป main scaffold:

```bash
cd /home/kanphong/Documents/GUILD_AI
bash scripts/package-guild-overlay.sh
npm run check
```

คาดหวัง:

- Overlay package ถูกสร้างที่ `dist/guild-ai-overlay`
- TypeScript check ผ่าน
- Docs ฝั่ง main scaffold ตรงกับ fork docs

## 14. สิ่งที่ Local-first MVP 100% เอาไปทำได้

ตอนนี้ Guild AI local-first MVP ใช้ทำสิ่งเหล่านี้ได้แล้ว:

1. รันบริษัท AI จำลองบนเครื่องตัวเอง
2. ใช้ Guild template `ecom-001` เป็นบริษัทตัวอย่าง
3. Bind local Ollama ให้ role ต่างๆ ของ guild
4. สั่งงาน smoke workflow แบบ Worker -> QA
5. ให้ระบบสร้าง artifact เช่น `SMOKE_RESULT.md`
6. บังคับ QA gate ว่าต้องมี evidence ก่อน approve
7. ดูบัญชีแบบไทย 5 หมวด
8. บันทึก token usage เป็น double-entry journal
9. ดู P&L และ net income
10. สร้าง upgrade proposal เพื่อ self-improvement
11. เก็บ event history ของ upgrade proposal
12. ให้ SGM Advisor เสนอคำแนะนำ
13. เก็บและตรวจ model limit เพื่อคุมต้นทุน
14. ตรวจ acceptance ทั้งระบบด้วยคำสั่งเดียว
15. ใช้เป็นฐานต่อยอด LAN/autostart/revenue/memory ได้

## 14.1 Secretary, Budget, Backup, Queue Test

ทดสอบ office operations layer:

1. เปิดหน้า Office
2. ลาก `Secretary Office` panel ไปตำแหน่งที่ไม่บัง CEO
3. Refresh browser แล้วตรวจว่า panel จำตำแหน่งเดิม
4. กด reset position แล้วตรวจว่ากลับตำแหน่ง default
5. กด `Send order` แล้วต้องไปหน้า Task Board และเปิด New Task modal
6. เข้า `Guild AI`
7. ดู `Budget guard` แล้วปรับ daily/monthly budget ได้
8. ตั้ง daily budget ต่ำกว่าค่าใช้จ่ายวันนี้ แล้วตรวจว่า verdict เป็น `blocked`
9. ดู `Backup readiness` แล้วกด `Run backup now`
10. ตรวจว่า `Latest snapshots` มี snapshot ใหม่
11. เข้า Settings -> Operations แล้วตรวจ default retention เป็น `14`
12. ปรับ retention แล้ว save/blur จากนั้นกลับมา Guild AI เพื่อตรวจ retention ที่แสดง
13. ดู `Real worker queue`
14. Enqueue job ใหม่
15. ถ้า Budget Guard blocked ปุ่ม Process next ต้องหยุด/disabled
16. เพิ่ม budget ให้ไม่ blocked แล้วกด `Process next`
17. ตรวจ queue item เปลี่ยนเป็น `succeeded`

คำสั่ง verify:

```bash
npm run build
npm run test:api
```

คาดหวังล่าสุด:

- Build ผ่าน
- API tests ผ่าน 75 files / 275 tests
- Secretary overlay ไม่บัง CEO แบบถาวรอีก
- Backup retention default 14 วัน และปรับได้ใน Settings
- Worker queue เคารพ Budget Guard ก่อน process งาน

## 15. Pass Criteria

ถือว่า Local-first MVP ผ่านเมื่อ:

- `npm run guild:mvp-check` ได้ `PASS (10/10)`
- UI เปิดหน้า Guild AI ได้
- Default guild `ecom-001` โหลดได้
- Ollama runtime binding สำเร็จ
- Smoke task มี artifact evidence
- QA approval ไม่ผ่านถ้าไม่มี evidence
- Accounting มี chart, journal, P&L
- Self-improvement proposal/advice/decision ทำงาน
- ไม่มี active model limit blocking MVP
- Build และ test suite ผ่าน

## 16. Next Work After MVP

หลัง MVP 100% งานถัดไปควรเดินตามนี้:

1. Push commits ไป `origin/main`
2. ต่อ revenue event จริงจากงานขาย/บริการ
3. ต่อ agent runner token usage จริงให้ลง accounting อัตโนมัติ
4. แตก `GuildAiPanel` เป็น components ย่อย
5. ทำ LAN/autostart hardening
6. เพิ่ม memory L2/L3 โดยให้ ChromaDB ยังเป็น optional
7. ทำ production security controls ก่อนเปิดใช้งานนอกเครื่อง

## 17. Quick Checklist

ใช้ checklist นี้ทุกครั้งก่อนบอกว่า build ปัจจุบันพร้อมใช้งาน:

- [ ] `ollama serve` เปิดอยู่
- [ ] `npm run dev:local` เปิดอยู่
- [ ] เปิด UI และเข้า `Guild AI` ได้
- [ ] Bootstrap Ollama runtime สำเร็จ
- [ ] Run smoke สำเร็จ
- [ ] Stage task smoke สำเร็จ
- [ ] Run staged smoke สำเร็จ
- [ ] Load latest smoke สำเร็จ
- [ ] Refresh artifacts เห็น `SMOKE_RESULT.md`
- [ ] QA pass หลัง evidence พร้อม
- [ ] Accounting แสดง chart/P&L/journal
- [ ] Self-improvement proposal/advice/decision ทำงาน
- [ ] `npm run guild:mvp-check` ผ่าน 10/10
- [ ] `npm run build` ผ่าน
- [ ] `npm run test:api` ผ่าน
- [ ] `npm run test:web` ผ่าน
- [ ] `bash scripts/package-guild-overlay.sh` ผ่าน
- [ ] `npm run check` ฝั่ง main scaffold ผ่าน
