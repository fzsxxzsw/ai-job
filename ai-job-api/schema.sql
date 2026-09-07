-- Authoritative schema for a fresh personal Python deployment.
-- Run against MYSQL_DATABASE selected by the MySQL entrypoint; no hard-coded database.
-- Existing installations use python -m job_helper_api.migrate --apply after backup.
-- No owner account or outbound automation is created/enabled by initialization.
CREATE TABLE IF NOT EXISTS msg_session
(
    id           bigint auto_increment comment '消息会话id'
        primary key,
    msg_context  text charset utf8mb4 null comment '消息上下文',
    ai_type      int                  null comment 'ai类型',
    status       int                  null comment '状态',
    user_id      int                  null comment '用户id',
    session_key  varchar(64)          null comment '会话key(用于job唯一键)',
    is_active    bit default b'0'     null comment '是否活跃',
    created_id   bigint               null comment '创建人',
    created_date datetime             null comment '创建时间',
    updated_id   bigint               null comment '更新人',
    updated_date datetime             null comment '更新时间'
)
    comment '消息会话表' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_ai_config
(
    id               bigint auto_increment comment '主键ID'
        primary key,
    user_id          bigint               not null comment '用户ID',
    provider         int     default 0    not null comment 'API提供商(0-自定义 1-DeepSeek 2-火山引擎 3-硅基流动 4-月之暗面 5-OpenRouter)',
    model_name       varchar(128)         null comment '模型名称',
    api_key          varchar(255)         not null comment 'API密钥',
    base_url         varchar(1024)        null comment '基础URL',
    completions_path varchar(255)         null comment '会话路径',
    timeout          int     default 30   null comment '超时时间(秒)',
    test_passed      tinyint default 0    not null comment '测试是否通过(0-未通过 1-已通过)',
    status           tinyint default 1    not null comment '状态(0-禁用 1-启用)',
    is_active        bit     default b'0' null comment '是否活跃',
    created_id       bigint               null comment '创建人',
    created_date     datetime             null comment '创建时间',
    updated_id       bigint               null comment '更新人',
    updated_date     datetime             null comment '更新时间',
    user_prompt      text                 null comment '用户提示词'
)
    comment '用户AI配置表'  ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_info
(
    id               bigint auto_increment
        primary key,
    phone            varchar(11)          null comment '手机号',
    email            varchar(56)          null comment '邮件',
    preference       text charset utf8mb4 null,
    is_active        bit default b'0'     null comment '是否活跃',
    created_id       bigint               null comment '创建人',
    created_date     datetime             null comment '创建时间',
    updated_id       bigint               null comment '更新人',
    updated_date     datetime             null comment '更新时间',
    unique_id        varchar(32)          null comment '平台唯一id;boss平台id',
    ai_seat_status   int                  null comment 'ai坐席状态 null-未使用 1-使用中(开) 0-使用中(关)',
    invite_code      varchar(64)          null comment '用户邀请码',
    bind_invite_code varchar(64)          null comment '绑定的邀请码'
)
    comment '用户信息表' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_resume
(
    id             bigint auto_increment
        primary key,
    user_id        bigint               null comment '用户id',
    resume_content text charset utf8mb4 null,
    resume_url     varchar(256)         null comment '保存简历url',
    is_active      bit default b'0'     null comment '是否活跃',
    created_id     bigint               null comment '创建人',
    created_date   datetime             null comment '创建时间',
    updated_id     bigint               null comment '更新人',
    updated_date   datetime             null comment '更新时间',
    oss_file_name  varchar(64)          null comment 'oss唯一对象名',
    preset_problem text charset utf8mb4 null,
    resume_id      varchar(64)          null comment 'boss平台简历id'
)
    comment '用户简历表' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_audit (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT NOT NULL, audit_id VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 delivery_key VARCHAR(240) NOT NULL, kind VARCHAR(20) NOT NULL, status VARCHAR(32) NOT NULL,
 job_title VARCHAR(300), content_hash VARCHAR(120) NOT NULL, content_length INT NOT NULL,
 attempts INT NOT NULL, event_created_at BIGINT NOT NULL, event_updated_at BIGINT NOT NULL,
 boss_id VARCHAR(80), conversation_key VARCHAR(240), client_mid VARCHAR(80), server_mid VARCHAR(80),
 observation_count INT NOT NULL, duplicate_count INT NOT NULL, transition_count INT NOT NULL,
 last_observed_at BIGINT NOT NULL,
 UNIQUE KEY uq_delivery_audit_user (user_id, audit_id), KEY idx_delivery_audit_user_updated (user_id, event_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_application_snapshot (
	id BIGINT NOT NULL AUTO_INCREMENT,
	user_id BIGINT NOT NULL,
	encrypt_job_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	applied_at BIGINT NOT NULL,
	job_base_info LONGTEXT,
	job_ext_info LONGTEXT,
	jd_hash VARCHAR(64) NOT NULL,
	resume_record_id BIGINT NOT NULL,
	resume_content LONGTEXT NOT NULL,
	resume_hash VARCHAR(64) NOT NULL,
	preference_snapshot LONGTEXT,
	pre_match_result LONGTEXT,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_snapshot_user_job UNIQUE (user_id, encrypt_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rejection_analysis (
	id BIGINT NOT NULL AUTO_INCREMENT,
	user_id BIGINT NOT NULL,
	application_snapshot_id BIGINT,
	encrypt_job_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	conversation_key VARCHAR(255),
	conversation_completeness VARCHAR(32) NOT NULL,
	conversation_json LONGTEXT NOT NULL,
	conversation_hash VARCHAR(64) NOT NULL,
	analysis_json LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL,
	analysis_source VARCHAR(32) NOT NULL,
	model VARCHAR(160) NOT NULL,
	prompt_version VARCHAR(64) NOT NULL,
	corrected_reason VARCHAR(1000),
	corrected_code VARCHAR(80),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS py_api_control (
	user_id BIGINT NOT NULL,
	control_key VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	value_json TEXT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, control_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS py_api_request (
	user_id BIGINT NOT NULL,
	session_key VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	request_hash VARCHAR(64) NOT NULL,
	status VARCHAR(32) NOT NULL,
	response_json TEXT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, session_key, request_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable application outcomes and human-confirmation workflow.

CREATE TABLE IF NOT EXISTS outcome_case (
	id VARCHAR(36) NOT NULL,
	user_id BIGINT NOT NULL,
	case_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
	encrypt_job_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	conversation_key VARCHAR(255) COLLATE utf8mb4_bin,
	boss_id VARCHAR(80) COLLATE utf8mb4_bin,
	revision BIGINT NOT NULL,
	facts_json LONGTEXT NOT NULL,
	current_report_id VARCHAR(36),
	status VARCHAR(32) NOT NULL,
	next_check_at BIGINT,
	last_observed_at BIGINT NOT NULL,
	last_verified_observation_at BIGINT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_outcome_case_owner_key UNIQUE (user_id, case_key),
	KEY ix_outcome_case_due (user_id, next_check_at)
);

CREATE TABLE IF NOT EXISTS outcome_feedback (
	id VARCHAR(36) NOT NULL,
	user_id BIGINT NOT NULL,
	report_id VARCHAR(36) NOT NULL,
	request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	action VARCHAR(16) NOT NULL,
	corrected_outcome VARCHAR(32),
	corrected_reason TEXT,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_outcome_feedback_owner_request UNIQUE (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS outcome_job (
	id VARCHAR(36) NOT NULL,
	user_id BIGINT NOT NULL,
	case_id VARCHAR(36) NOT NULL,
	revision BIGINT NOT NULL,
	context_json LONGTEXT,
	input_hash VARCHAR(64),
	status VARCHAR(32) NOT NULL,
	phase VARCHAR(32) NOT NULL,
	phase_history_json LONGTEXT NOT NULL,
	available_at BIGINT NOT NULL,
	lease_token VARCHAR(128),
	lease_until BIGINT,
	attempts INTEGER NOT NULL,
	artifact_json LONGTEXT,
	artifact_id VARCHAR(36),
	validation_hash VARCHAR(64),
	report_id VARCHAR(36),
	feedback_id VARCHAR(36),
	last_error_code VARCHAR(64),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_outcome_job_case_revision UNIQUE (case_id, revision),
	KEY ix_outcome_job_claim (user_id, status, available_at)
);

CREATE TABLE IF NOT EXISTS outcome_observation (
	id VARCHAR(36) NOT NULL,
	user_id BIGINT NOT NULL,
	event_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
	case_id VARCHAR(36) NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	source VARCHAR(40) NOT NULL,
	observed_at BIGINT NOT NULL,
	received_at BIGINT NOT NULL,
	payload_json LONGTEXT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_outcome_observation_owner_event UNIQUE (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS outcome_report (
	id VARCHAR(36) NOT NULL,
	user_id BIGINT NOT NULL,
	case_id VARCHAR(36) NOT NULL,
	revision BIGINT NOT NULL,
	report_json LONGTEXT NOT NULL,
	feedback_status VARCHAR(32) NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_outcome_report_case_revision UNIQUE (case_id, revision)
);

-- Durable graph jobs and exact browser action receipts.
CREATE TABLE IF NOT EXISTS automation_action (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	job_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	kind VARCHAR(24) NOT NULL,
	sequence INTEGER NOT NULL,
	status VARCHAR(24) NOT NULL,
	payload_json LONGTEXT NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	approval_status VARCHAR(24) NOT NULL,
	approval_id VARCHAR(36) COLLATE utf8mb4_bin,
	executor_id VARCHAR(128) COLLATE utf8mb4_bin,
	lease_token VARCHAR(128) COLLATE utf8mb4_bin,
	lease_until BIGINT,
	authorization_revision BIGINT,
	client_mid VARCHAR(128) COLLATE utf8mb4_bin,
	server_mid VARCHAR(128) COLLATE utf8mb4_bin,
	dispatch_token VARCHAR(128) COLLATE utf8mb4_bin,
	last_error_code VARCHAR(64),
	finalized INTEGER NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_automation_action_sequence UNIQUE (job_id, sequence),
	CONSTRAINT uq_automation_action_client_mid UNIQUE (user_id, client_mid),
	CONSTRAINT uq_automation_action_server_mid UNIQUE (user_id, server_mid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_action_event (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	job_id VARCHAR(36) COLLATE utf8mb4_bin,
	action_id VARCHAR(36) COLLATE utf8mb4_bin,
	request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
	kind VARCHAR(24) NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	payload_json LONGTEXT NOT NULL,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_automation_event_request UNIQUE (user_id, request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_job (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	business_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
	kind VARCHAR(24) NOT NULL,
	platform_account VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	conversation_key VARCHAR(255) COLLATE utf8mb4_bin,
	encrypt_job_id VARCHAR(255) COLLATE utf8mb4_bin,
	boss_id VARCHAR(255) COLLATE utf8mb4_bin,
	revision BIGINT NOT NULL,
	input_hash VARCHAR(64) NOT NULL,
	input_json LONGTEXT NOT NULL,
	context_json LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL,
	phase VARCHAR(32) NOT NULL,
	phase_history_json LONGTEXT NOT NULL,
	available_at BIGINT NOT NULL,
	lease_token VARCHAR(128) COLLATE utf8mb4_bin,
	lease_until BIGINT,
	attempts INTEGER NOT NULL,
	compute_started INTEGER NOT NULL,
	graph_finalized INTEGER NOT NULL DEFAULT 1,
	artifact_id VARCHAR(36) COLLATE utf8mb4_bin,
	artifact_json LONGTEXT,
	validation_hash VARCHAR(64),
	result_json LONGTEXT,
	result_id VARCHAR(36) COLLATE utf8mb4_bin,
	last_error_code VARCHAR(64),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_automation_job_business UNIQUE (user_id, business_key),
	KEY ix_automation_job_claim (user_id, status, available_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable career facts, resume drafts and approved strategy plans.
CREATE TABLE IF NOT EXISTS career_application (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	application_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
	platform_account VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	encrypt_job_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
	conversation_key VARCHAR(255) COLLATE utf8mb4_bin,
	boss_id VARCHAR(255) COLLATE utf8mb4_bin,
	cycle_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
	job_id VARCHAR(36) COLLATE utf8mb4_bin,
	prepared_resume_version_id VARCHAR(36) COLLATE utf8mb4_bin,
	strategy_plan_id VARCHAR(36) COLLATE utf8mb4_bin,
	contacted_at BIGINT,
	data_json LONGTEXT NOT NULL,
	legacy_snapshot_id BIGINT,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_career_application_cycle UNIQUE (user_id, application_key),
	KEY ix_career_application_cohort (user_id, contacted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS career_application_event (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	application_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	event_type VARCHAR(32) NOT NULL,
	occurred_at BIGINT NOT NULL,
	confirmation VARCHAR(24) NOT NULL,
	evidence_json LONGTEXT NOT NULL,
	supersedes_event_id VARCHAR(36) COLLATE utf8mb4_bin,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	KEY ix_career_event_timeline (application_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS career_resume_exposure (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	application_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	event_id VARCHAR(36) COLLATE utf8mb4_bin,
	resume_version_id VARCHAR(36) COLLATE utf8mb4_bin,
	state VARCHAR(16) NOT NULL,
	verification_kind VARCHAR(32) NOT NULL,
	platform_resume_id VARCHAR(128) COLLATE utf8mb4_bin,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_career_exposure_event UNIQUE (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS career_resume_proposal (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	job_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	base_version_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	status VARCHAR(16) NOT NULL,
	data_json LONGTEXT NOT NULL,
	accepted_version_id VARCHAR(36) COLLATE utf8mb4_bin,
	accept_hash VARCHAR(64),
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS career_resume_version (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	parent_id VARCHAR(36) COLLATE utf8mb4_bin,
	source VARCHAR(24) NOT NULL,
	content_hash VARCHAR(64) NOT NULL,
	data_json LONGTEXT NOT NULL,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id),
	KEY ix_career_resume_owner_hash (user_id, content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS career_strategy_plan (
	id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	user_id BIGINT NOT NULL,
	job_id VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
	status VARCHAR(16) NOT NULL,
	data_json LONGTEXT NOT NULL,
	preview_hash VARCHAR(64) NOT NULL,
	base_preference_hash VARCHAR(64) NOT NULL,
	approved_at BIGINT,
	applied_at BIGINT,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
