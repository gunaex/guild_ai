# Guild AI User Manual

คู่มือนี้สำหรับการลองใช้ Guild AI Local-first MVP บนเครื่องตัวเองแบบไม่ต้องเดา flow เอง

สถานะปัจจุบัน:

- Local-first MVP: 100%
- Default guild: `ecom-001`
- API: `http://127.0.0.1:8790`
- UI: ดูพอร์ตจริงจาก terminal หลังรัน `npm run dev:local`
- Local AI: รองรับ Ollama ผ่าน local API provider layer

## 1. Guild AI ตอนนี้คืออะไร

Guild AI ตอนนี้คือบริษัท AI local-first ที่รันบนเครื่องเราเอง โดยใช้ Claw-Empire เป็นฐาน และเพิ่มชั้น Guild เข้าไป:

- มีบริษัทตัวอย่าง `ecom-001`
- มี roles เช่น PM, Tech Lead, Worker, QA, HR, Accounting
- ผูก roles กับ local model ผ่าน Ollama ได้
- สั่ง smoke task ให้ Worker ทำงานและส่งต่อ QA ได้
- QA approve ได้เฉพาะเมื่อมี evidence จริง
- บันทึกบัญชี token usage, AI credit, revenue และ P&L ได้
- มี self-improvement proposal และ SGM Advisor advice
- มี model limit governance เพื่อหยุดเฉพาะ model/provider ที่ติด limit
- มี L2 memory แบบ SQLite สำหรับจำ operating notes, advice, decisions, และ accounting context
- มี HR governance review และ human decision gate ก่อน termination/replacement
- มี Deployment readiness สำหรับเช็คก่อนเปิดใช้งานบน LAN/internet
- มี Backup readiness สำหรับเช็คไฟล์สำรองข้อมูลของระบบระยะยาว
- มี Final launch readiness สำหรับดู Full vision/MVP progress และ gate ก่อนเริ่มทดสอบวันนี้

คิดง่ายๆ คือ ตอนนี้เรามี "บริษัท AI local ตัวแรก" ที่ใช้ทดสอบงาน, governance, accounting, และ runtime control ได้แล้ว

## 2. เปิดระบบครั้งแรก

เปิด terminal ที่ 1:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
ollama serve
```

ถ้า `ollama serve` แจ้งว่ามี server อยู่แล้ว ให้ปล่อยไว้ได้

เปิด terminal ที่ 2:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
npm run dev:local
```

ดู output ใน terminal ว่า Vite เปิด UI ที่ port ไหน เช่น:

```text
http://127.0.0.1:8802
```

เปิด browser ไปที่ URL นั้น แล้วเลือกเมนู `Guild AI`

## 3. ตรวจว่าระบบพร้อม

จาก terminal ใน fork:

```bash
npm run guild:mvp-check
```

ถ้าพร้อมจะเห็น:

```text
Guild AI local MVP check: PASS (10/10)
```

ถ้าไม่ผ่าน ให้ดูหัวข้อ Troubleshooting ด้านล่าง

## 4. หน้า Guild AI มีอะไรบ้าง

ในหน้า `Guild AI` ให้มองเป็น 8 โซนหลัก:

1. Metrics
   - ดู capability level
   - ดู pending upgrades
   - ดู net income
   - ใช้ดูสุขภาพรวมของ guild

2. SGM Briefing / Readiness
   - สรุปว่าระบบพร้อมแค่ไหน
   - บอก next actions
   - ชี้ว่าติด runtime, limit, smoke, accounting, หรือ governance

3. Runtime Bindings
   - ดูว่า role ไหนผูกกับ agent/model ไหน
   - ใช้ `Bootstrap Ollama runtime`
   - ดูสถานะ available, limited, disabled

4. Smoke Workflow
   - ใช้ลองงานจริงแบบปลอดภัย
   - มี `Run smoke`, `Stage task smoke`, `Run staged smoke`
   - มี `Load latest smoke`, `Refresh artifacts`
   - มี route decision เช่น `worker_done`, `qa_pass`, `qa_fail`, `techlead_escalate`

5. Smoke Artifacts
   - ดูไฟล์ evidence
   - สำคัญสุดคือ `SMOKE_RESULT.md`
   - ถ้า evidence ยัง pending ปุ่ม `qa_pass` จะยังใช้ไม่ได้

6. Accounting
   - ดู chart of accounts แบบไทย 5 หมวด
   - ดู P&L
   - ดู journal entries
   - record sample token spend / AI credit / revenue

7. Self-improvement
   - สร้าง upgrade proposal
   - ดู proposal event history
   - approve/reject/sandbox/needs_info
   - ป้องกันระบบ upgrade ตัวเองโดยไม่มีมนุษย์อนุมัติ

8. SGM Advisor Advice
   - เพิ่มคำแนะนำจาก human/SGM
   - จัด category และ priority
   - ใช้เป็น memory/governance seed สำหรับการพัฒนาต่อ

9. L2 Memory
   - บันทึก operating note แบบถาวร
   - แยก namespace เช่น operations, governance, accounting, runtime, customer, learning
   - ระบบ auto-capture บางเหตุการณ์ เช่น proposal, decision, advice, revenue
   - ใช้เป็นฐานก่อนต่อ ChromaDB L3 memory ภายหลัง

10. HR Governance
   - บันทึก productivity review
   - ถ้าคะแนนต่ำกว่าพื้นฐาน ระบบสร้าง governance request
   - termination/replacement ต้องรอ human decision
   - decision ถูกบันทึกกลับเข้า memory/governance trail

11. Deployment Readiness
   - ตรวจว่า server bind แค่ local หรือพร้อม LAN
   - ตรวจ `API_AUTH_TOKEN`, allowed origins, CSRF, audit log, dev-server exposure
   - internet mode ต้องมี HTTPS reverse proxy และไม่ควรใช้ Vite dev server
   - ใช้เป็น checkpoint ก่อนเปิดให้เครื่องอื่นเข้าถึง

12. Backup Readiness
   - ตรวจ SQLite DB, WAL/SHM, logs, security audit
   - ตรวจว่า `GUILD_AI_BACKUP_DIR` พร้อมหรือยัง
   - แสดง manifest ของไฟล์ที่ควร backup
   - ยังไม่ restore หรือ overwrite ข้อมูลเอง

13. Final Launch Readiness
   - รวม template, runtime, accounting, smoke evidence, memory, HR, deployment, backup
   - แสดง Full Guild AI vision และ Local-first MVP progress
   - ใช้เป็นแผงแรกก่อนเริ่มทดสอบจริง
   - ถ้า critical gate ไม่ block ก็เริ่ม trial local ได้

## 5. Workflow แรกที่ควรลอง

ทำตามลำดับนี้เพื่อพิสูจน์ว่า Guild AI ทำงานจริง:

### Step 1: Bootstrap Ollama runtime

ในหน้า Guild AI กด:

```text
Bootstrap Ollama runtime
```

คาดหวัง:

- roles หลักถูก bind กับ Local Ollama
- runtime bindings แสดง provider/model
- status ควรเป็น `available`

ถ้าไม่ผ่าน:

- ตรวจว่า `ollama serve` เปิดอยู่
- ตรวจว่า `ollama list` มี model
- ถ้ายังไม่มี model ให้รัน `ollama pull llama3.1:8b`

### Step 2: Run smoke

กด:

```text
Run smoke
```

สิ่งนี้คือ smoke test แบบเร็ว ไม่สร้าง task/worktree จริง ใช้เช็คว่า runtime binding ตอบผ่าน local model ได้

คาดหวัง:

- มี output จาก local model
- ไม่มี error เรื่อง provider/model

### Step 3: Stage task smoke

กด:

```text
Stage task smoke
```

สิ่งนี้จะสร้าง task ใน scratch project ชั่วคราว ไม่แตะ source repo จริง

คาดหวัง:

- ได้ task smoke ใหม่
- task อยู่สถานะ planned
- มีไฟล์ brief ชื่อ `GUILD_SMOKE.md`

### Step 4: Run staged smoke

กด:

```text
Run staged smoke
```

ระบบจะให้ Worker ทำ task ใน scratch project

คาดหวัง:

- Worker เริ่มทำงาน
- task log มีความเคลื่อนไหว
- เมื่อ Worker ทำสำเร็จ ระบบ route ไป QA review

### Step 5: Load latest smoke

กด:

```text
Load latest smoke
```

ใช้ดึง task smoke ล่าสุดกลับมาดู โดยเฉพาะหลัง refresh หน้า หรือหลัง server restart

### Step 6: Refresh artifacts

กด:

```text
Refresh artifacts
```

ตรวจไฟล์:

```text
SMOKE_RESULT.md
```

คาดหวัง:

- evidence status เป็น ready
- `SMOKE_RESULT.md` มีเนื้อหาผลลัพธ์

### Step 7: QA approve

หลัง evidence ready แล้ว กด route decision:

```text
qa_pass
```

คาดหวัง:

- task ปิดเป็น done
- ถ้า evidence ไม่พร้อม ระบบต้อง block ไม่ให้ qa_pass

## 6. ทดลองบัญชี

ในโซน Accounting ให้ลอง:

1. ดู Chart of Accounts
2. ดู P&L
3. ดู Latest Journal Entries
4. กด record sample token spend
5. ถ้ามีปุ่ม sample revenue ให้บันทึกรายได้ตัวอย่าง
6. ถ้ามีปุ่ม AI credit topup ให้บันทึกเครดิต AI ตัวอย่าง

สิ่งที่ควรเข้าใจ:

- Token usage คือค่าใช้จ่าย
- Revenue คือรายได้
- P&L คือสรุปกำไรขาดทุน
- Journal entry ใช้หลัก double-entry
- ระบบมีหมวดบัญชีไทย 5 หมวด: asset, liability, equity, revenue, expense

## 7. ทดลอง Self-improvement

ให้ลองสร้าง proposal:

- Capability area: `runtime`
- Target level: `2`
- Title: `Improve local smoke reliability`
- Rationale: `Reduce failed local task runs by tightening preflight checks`
- Rollback plan: `Disable the new check and return to current runtime binding selection`

จากนั้น:

1. สร้าง proposal
2. เปิด event history
3. เพิ่ม SGM Advisor advice
4. ทดลอง decision เช่น `sandbox` หรือ `needs_info`

ข้อควรจำ:

- อย่า approve upgrade ที่เสี่ยงโดยไม่มี rollback plan
- ถ้าจะให้ระบบเปลี่ยน behavior จริง ให้ใช้ sandbox ก่อน
- เป้าหมายคือ self-improvement แบบมีมนุษย์คุม ไม่ใช่ปล่อย AI upgrade เองไร้กรอบ

## 8. ทดลอง Model Limit Governance

ตอนนี้ระบบถูกออกแบบให้:

- ถ้า model/provider ใดติด limit ให้ pause เฉพาะตัวนั้น
- ถ้ามี runtime binding สำรองใน role เดียวกัน ให้ switch ไปใช้ตัวที่ available
- เมื่อ cooldown หมด ระบบ recover ให้อัตโนมัติ
- limit event ถูกเก็บไว้เพื่อคุมต้นทุนและ evaluate provider

ดูสถานะในหน้า Guild AI:

- runtime binding status
- recent AI limit events
- SGM readiness checklist

สำหรับ MVP ปกติ acceptance ต้องไม่มี active model limit blocking:

```bash
npm run guild:mvp-check
```

## 9. ใช้ Acceptance Checker ตอนไหน

รันคำสั่งนี้ทุกครั้งหลัง:

- restart server
- เปลี่ยน runtime/model
- แก้ Guild AI routes
- แก้ accounting
- แก้ smoke workflow
- ก่อน push ขึ้น GitHub

คำสั่ง:

```bash
npm run guild:mvp-check
```

ถ้าขึ้น `PASS (10/10)` ถือว่า Local-first MVP ยังพร้อมใช้งาน

## 10. คำสั่งที่ใช้บ่อย

เข้า fork:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
```

เปิด dev runtime:

```bash
npm run dev:local
```

เปิด server ตรง:

```bash
./node_modules/.bin/tsx server/index.ts
```

ตรวจ MVP:

```bash
npm run guild:mvp-check
```

build:

```bash
npm run build
```

test API:

```bash
npm run test:api
```

test web:

```bash
npm run test:web
```

push:

```bash
git push
```

## 11. เอาไปทำอะไรได้ตอนนี้

ตอนนี้ MVP 100% เอาไปใช้ได้จริงในขอบเขตนี้:

1. ใช้เป็น control room สำหรับบริษัท AI local
2. ใช้ลอง local model ผ่าน Ollama
3. ใช้สร้างและรัน smoke task แบบปลอดภัย
4. ใช้ทดสอบ Worker -> QA lifecycle
5. ใช้บังคับ QA evidence ก่อน approve
6. ใช้ดูบัญชีต้นทุน token และ P&L
7. ใช้บันทึก AI credit, token spend, revenue
8. ใช้เก็บ upgrade proposal
9. ใช้รับคำแนะนำจาก SGM Advisor
10. ใช้บันทึก L2 memory เพื่อให้ guild จำบริบทสำคัญ
11. ใช้บันทึก HR review และ human governance decision
12. ใช้ตรวจ deployment readiness ก่อนเปิด LAN/internet
13. ใช้ตรวจ backup readiness สำหรับ long-running service
14. ใช้ Final launch readiness เป็นจุดเริ่มทดสอบวันนี้
15. ใช้เก็บ model limit events เพื่อคุมต้นทุน
16. ใช้เป็นฐานสำหรับ LAN/autostart
17. ใช้เป็นฐานต่อ ChromaDB L3 memory ในอนาคต

## 12. สิ่งที่ยังไม่ควรทำ

ตอนนี้ยังไม่ควร:

- เปิด dev server ขึ้น internet ตรงๆ
- ให้ระบบแก้ production repo โดยไม่มี sandbox
- ให้ AI approve self-upgrade เอง
- ใช้ paid provider โดยไม่ตั้ง pricing/cost control
- เชื่อว่า P&L เป็นบัญชีภาษีจริงแบบยื่นได้ทันที
- ใช้งานหลายเครื่องผ่าน LAN ก่อนทำ security hardening

## 13. Troubleshooting

### เปิด UI ไม่ได้

ตรวจ terminal `npm run dev:local` ว่าพอร์ต UI คืออะไร

ถ้า port เปลี่ยน ให้เปิดตามที่ Vite แสดง เช่น:

```text
http://127.0.0.1:8802
```

### `npm run guild:mvp-check` ต่อ API ไม่ได้

ตรวจว่า server เปิดอยู่:

```bash
curl -s http://127.0.0.1:8790/api/auth/session
```

ถ้า server ใช้ port อื่น:

```bash
GUILD_AI_BASE_URL=http://127.0.0.1:8790 npm run guild:mvp-check
```

### Bootstrap Ollama ไม่ผ่าน

ตรวจ:

```bash
ollama list
```

ถ้าไม่มี model:

```bash
ollama pull llama3.1:8b
```

ถ้า Ollama ยังไม่เปิด:

```bash
ollama serve
```

### `qa_pass` กดไม่ได้

สาเหตุปกติ:

- smoke task ยังไม่มี evidence
- `SMOKE_RESULT.md` ยัง pending
- task ยังไม่เข้า QA review

ให้กด:

```text
Refresh artifacts
```

แล้วดูว่า evidence ready หรือยัง

### Net income ติดลบ

ปกติสำหรับช่วงทดสอบ เพราะมี token cost แต่รายได้อาจยังน้อยหรือยังไม่ได้ record

ลองบันทึก sample revenue เพื่อดู P&L ฝั่งรายได้

### Model limit active

ระบบจะ pause เฉพาะ provider/model ที่ติด limit

ให้รอ cooldown หรือเปลี่ยน binding ไปใช้ model/provider ที่ available

## 14. Daily Use Flow

ถ้าจะใช้ Guild AI ทุกวัน ให้ใช้ flow นี้:

1. เปิด `ollama serve`
2. เปิด `npm run dev:local`
3. เข้า UI เมนู `Guild AI`
4. อ่าน SGM briefing
5. ตรวจ runtime bindings
6. ตรวจ model limits
7. สั่ง smoke หรือ task ทดลอง
8. ตรวจ artifacts
9. ให้ QA decision
10. ตรวจ accounting
11. รัน `npm run guild:mvp-check`
12. commit/push เฉพาะเมื่อ checks ผ่าน

## 15. เอกสารที่ควรอ่านคู่กัน

- `docs/guild-ai/TEST_PLAN.md`: แผนทดสอบแบบ checklist
- `docs/guild-ai/ROADMAP.md`: แผนต่อไป
- `docs/guild-ai/PROGRESS.md`: progress ล่าสุด
- `docs/guild-ai/HANDOVER.md`: handover สำหรับ chat/account ใหม่
- `docs/guild-ai/AUTOSTART.md`: แนวทางเปิดอัตโนมัติ
- `docs/guild-ai/MEMORY_STRATEGY.md`: แผน memory L2/L3

## 16. Golden Rule

ทุกครั้งที่ไม่แน่ใจว่าระบบยังพร้อมไหม ให้รัน:

```bash
npm run guild:mvp-check
```

ถ้าผ่าน 10/10 แปลว่า Local-first MVP ยังอยู่ในสถานะพร้อมใช้งาน
