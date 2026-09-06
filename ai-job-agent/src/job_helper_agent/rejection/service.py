import json
from sqlalchemy import select, func
from .contracts import RejectionError
from .store import canonical, digest, millis
from .rules import (redact, analyze_rules, validate_ai, ALLOWED_CODES,
                    PROMPT_VERSION, TAXONOMY_VERSION)


def report_view(row):
    try:
        value = json.loads(row['analysis_json'])
        if not isinstance(value, dict): raise ValueError()
    except (TypeError, ValueError):
        raise RejectionError(422, '历史分析记录格式异常，请保留记录并检查') from None
    result = {key: value.get(key, []) for key in
              ('explicitReasons','inferredRisks','unknowns','suggestions','evidence')}
    if not all(isinstance(v, list) for v in result.values()):
        raise RejectionError(422, '历史分析记录格式异常')
    result.update(id=row['id'], applicationSnapshotId=row['application_snapshot_id'],
        status=row['status'], analysisSource=row['analysis_source'],
        conversationCompleteness=row['conversation_completeness'], model=row['model'],
        promptVersion=row['prompt_version'], taxonomyVersion=TAXONOMY_VERSION,
        createdAt=row['created_at'], correctedReason=row['corrected_reason'])
    return result


def snapshot_view(row):
    return {'id':row['id'], 'encryptJobId':row['encrypt_job_id'], 'appliedAt':row['applied_at'],
            'resumeRecordId':row['resume_record_id'], 'resumeHash':row['resume_hash'],
            'jdHash':row['jd_hash'], 'createdAt':row['created_at']}


class RejectionService:
    def __init__(self, store, model):
        self.store, self.model = store, model

    async def save_snapshot(self, uid, payload):
        db = self.store
        async with db.guard(uid, 'snapshot:' + payload.encryptJobId) as conn:
            prior = await db.snapshot(conn, uid, payload.encryptJobId)
            if prior: return snapshot_view(prior)
            if not millis() - 300000 <= payload.appliedAt <= millis() + 60000:
                raise RejectionError(422, '不能用当前简历补造历史投递快照；历史拒绝仍可仅分析对话')
            user, resume = await db.user(conn, uid), await db.latest_resume(conn, uid)
            if not resume or not resume['resume_content']:
                raise RejectionError(422, '没有可保存的简历快照，请先导入简历')
            values = dict(user_id=uid, encrypt_job_id=payload.encryptJobId, applied_at=payload.appliedAt,
                job_base_info=payload.jobBaseInfo, job_ext_info=payload.jobExtInfo,
                jd_hash=digest([payload.jobBaseInfo,payload.jobExtInfo]), resume_record_id=resume['id'],
                resume_content=resume['resume_content'], resume_hash=digest(resume['resume_content']),
                preference_snapshot=user['preference'], pre_match_result=canonical(payload.preMatchResult),
                created_at=millis())
            table = db.table('job_application_snapshot')
            result = await conn.execute(table.insert().values(**values))
            return snapshot_view(dict(values, id=result.inserted_primary_key[0]))

    async def analyze(self, uid, payload):
        db, table = self.store, self.store.table('rejection_analysis')
        messages = [dict(role=m.role, text=redact(m.text)) for m in payload.messages]
        if not any(m['role']=='HR' and m['text'] for m in messages):
            raise RejectionError(422, '当前资料没有HR原话，不能判断拒绝原因')
        conversation_ref = 'rj:' + digest([uid, payload.conversationKey])
        fingerprint = digest(['rejection-v1', uid, payload.encryptJobId, conversation_ref,
                              [(m['role'], ' '.join(m['text'].split())) for m in messages]])
        async with db.guard(uid, 'analysis:' + fingerprint) as conn:
            await db.user(conn, uid)
            prior = await db.one(conn, select(table).where(table.c.user_id == uid,
                db.exact(table.c.encrypt_job_id, payload.encryptJobId),
                table.c.conversation_hash == fingerprint).order_by(table.c.id.desc()).limit(1))
            if prior: return report_view(prior)
            snapshot = await db.snapshot(conn, uid, payload.encryptJobId)
            evidence = [dict(id='D'+str(i+1), source='HR_DIALOGUE' if m['role']=='HR' else 'USER_DIALOGUE',
                             text=m['text']) for i,m in enumerate(messages)]
            if snapshot:
                for ident, source, column, limit in [('J1','JOB_BASE','job_base_info',8000),
                    ('J2','JOB_DESCRIPTION','job_ext_info',20000),('R1','RESUME_SNAPSHOT','resume_content',20000)]:
                    content = redact(str(snapshot[column] or ''))[:limit]
                    if content: evidence.append(dict(id=ident, source=source, text=content))
            report = analyze_rules(evidence)
            source, model_name = 'RULES_ONLY', 'none'
            try:
                row = await db.model_config(conn, uid)
                answer, model_name = await self.model.review(evidence, row)
                if validate_ai(answer, evidence): source = 'RULES_AI'
                else: report['unknowns'].append('模型输出未通过证据校验，保留可核验的规则结论')
            except RejectionError as error:
                report['unknowns'].append(error.message)
            values = dict(user_id=uid, application_snapshot_id=snapshot['id'] if snapshot else None,
                encrypt_job_id=payload.encryptJobId, conversation_key=conversation_ref,
                conversation_completeness='POSSIBLY_INCOMPLETE', conversation_json=canonical(messages),
                conversation_hash=fingerprint, analysis_json=canonical(report), status='PENDING',
                analysis_source=source, model=model_name, prompt_version=PROMPT_VERSION,
                corrected_reason=None, corrected_code=None, created_at=millis(), updated_at=millis())
            result = await conn.execute(table.insert().values(**values))
            return report_view(dict(values, id=result.inserted_primary_key[0]))

    async def get_report(self, uid, ident):
        db, table = self.store, self.store.table('rejection_analysis')
        async with db.engine.connect() as conn:
            row = await db.one(conn, select(table).where(table.c.id == ident, table.c.user_id == uid))
            if not row: raise RejectionError(404, '分析记录不存在或不属于当前用户')
            return report_view(row)

    async def feedback(self, uid, ident, payload):
        db, table = self.store, self.store.table('rejection_analysis')
        async with db.guard(uid, 'feedback:' + str(ident)) as conn:
            row = await db.one(conn, select(table).where(table.c.id == ident, table.c.user_id == uid).with_for_update())
            if not row: raise RejectionError(404, '分析记录不存在或不属于当前用户')
            report_view(row)
            values = dict(status={'CONFIRM':'CONFIRMED','CORRECT':'CORRECTED','IGNORE':'IGNORED'}[payload.action],
                          updated_at=millis())
            if payload.action == 'CORRECT':
                if not payload.correctedReason: raise RejectionError(422, '请填写纠正原因')
                code = (payload.correctedCode or 'USER_CORRECTION').upper()
                values.update(corrected_reason=redact(payload.correctedReason),
                              corrected_code=code if code in ALLOWED_CODES else 'USER_CORRECTION')
            else: values.update(corrected_reason=None, corrected_code=None)
            await conn.execute(table.update().where(table.c.id == ident, table.c.user_id == uid).values(**values))
            return report_view(dict(row, **values))

    async def summary(self, uid):
        db, table = self.store, self.store.table('rejection_analysis')
        async with db.engine.connect() as conn:
            rows = (await conn.execute(select(table).where(table.c.user_id == uid,
                    table.c.status.in_(['CONFIRMED','CORRECTED'])))).mappings().all()
        counts = {}
        for row in rows:
            value = report_view(row)
            codes = {row['corrected_code'] or 'USER_CORRECTION'} if row['status']=='CORRECTED' else {
                f.get('code','UNKNOWN') for f in value['explicitReasons'] + value['inferredRisks']}
            for code in codes or {'UNKNOWN'}: counts[code] = counts.get(code,0) + 1
        return dict(visible=len(rows)>=5, totalConfirmed=len(rows), categoryCounts=counts if len(rows)>=5 else {})

    async def history(self, uid):
        db, table = self.store, self.store.table('rejection_analysis')
        async with db.engine.connect() as conn:
            rows = (await conn.execute(select(table).where(table.c.user_id == uid)
                .order_by(table.c.created_at.desc(),table.c.id.desc()).limit(20))).mappings().all()
        return [dict(id=r['id'],status=r['status'],analysisSource=r['analysis_source'],createdAt=r['created_at']) for r in rows]
