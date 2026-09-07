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
