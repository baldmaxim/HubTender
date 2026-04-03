-- Database Schema SQL Export
-- Generated: 2025-12-30T13:46:01.534275
-- Database: postgres
-- Host: aws-1-eu-west-1.pooler.supabase.com

-- ============================================
-- TABLES
-- ============================================

-- Table: auth.audit_log_entries
-- Description: Auth: Audit trail for user actions.
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) NOT NULL DEFAULT ''::character varying,
    CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';

-- Table: auth.flow_state
-- Description: stores metadata for pkce logins
CREATE TABLE IF NOT EXISTS auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text NOT NULL,
    code_challenge_method USER-DEFINED NOT NULL,
    code_challenge text NOT NULL,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    CONSTRAINT flow_state_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.flow_state IS 'stores metadata for pkce logins';

-- Table: auth.identities
-- Description: Auth: Stores identities associated to a user.
CREATE TABLE IF NOT EXISTS auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT identities_pkey PRIMARY KEY (id),
    CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider),
    CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id),
    CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';
COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';

-- Table: auth.instances
-- Description: Auth: Manages users across multiple sites.
CREATE TABLE IF NOT EXISTS auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT instances_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';

-- Table: auth.mfa_amr_claims
-- Description: auth: stores authenticator method reference claims for multi factor authentication
CREATE TABLE IF NOT EXISTS auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL,
    CONSTRAINT amr_id_pk PRIMARY KEY (id),
    CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (authentication_method),
    CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id),
    CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';

-- Table: auth.mfa_challenges
-- Description: auth: stores metadata about challenge requests made
CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb,
    CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES None.None(None),
    CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';

-- Table: auth.mfa_factors
-- Description: auth: stores metadata about factors
CREATE TABLE IF NOT EXISTS auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type USER-DEFINED NOT NULL,
    status USER-DEFINED NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb,
    CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at),
    CONSTRAINT mfa_factors_pkey PRIMARY KEY (id),
    CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';
COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';

-- Table: auth.oauth_authorizations
CREATE TABLE IF NOT EXISTS auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method USER-DEFINED,
    response_type USER-DEFINED NOT NULL DEFAULT 'code'::auth.oauth_response_type,
    status USER-DEFINED NOT NULL DEFAULT 'pending'::auth.oauth_authorization_status,
    authorization_code text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:03:00'::interval),
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code),
    CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id),
    CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES None.None(None),
    CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);

-- Table: auth.oauth_client_states
-- Description: Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.
CREATE TABLE IF NOT EXISTS auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';

-- Table: auth.oauth_clients
CREATE TABLE IF NOT EXISTS auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type USER-DEFINED NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    deleted_at timestamp with time zone,
    client_type USER-DEFINED NOT NULL DEFAULT 'confidential'::auth.oauth_client_type,
    CONSTRAINT oauth_clients_pkey PRIMARY KEY (id)
);

-- Table: auth.oauth_consents
CREATE TABLE IF NOT EXISTS auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES None.None(None),
    CONSTRAINT oauth_consents_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_consents_user_client_unique UNIQUE (client_id),
    CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id),
    CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);

-- Table: auth.one_time_tokens
CREATE TABLE IF NOT EXISTS auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type USER-DEFINED NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);

-- Table: auth.refresh_tokens
-- Description: Auth: Store of tokens used to refresh JWT tokens once they expire.
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
    instance_id uuid,
    id bigint(64) NOT NULL DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass),
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid,
    CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES None.None(None),
    CONSTRAINT refresh_tokens_token_unique UNIQUE (token)
);
COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';

-- Table: auth.saml_providers
-- Description: Auth: Manages SAML Identity Provider connections.
CREATE TABLE IF NOT EXISTS auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id),
    CONSTRAINT saml_providers_pkey PRIMARY KEY (id),
    CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';

-- Table: auth.saml_relay_states
-- Description: Auth: Contains SAML Relay State information for each Service Provider initiated login.
CREATE TABLE IF NOT EXISTS auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES None.None(None),
    CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id),
    CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';

-- Table: auth.schema_migrations
-- Description: Auth: Manages updates to the auth system.
CREATE TABLE IF NOT EXISTS auth.schema_migrations (
    version character varying(255) NOT NULL
);
COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';

-- Table: auth.sessions
-- Description: Auth: Stores session data associated to a user.
CREATE TABLE IF NOT EXISTS auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal USER-DEFINED,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint(64),
    scopes text,
    CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES None.None(None),
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';
COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';
COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';
COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';

-- Table: auth.sso_domains
-- Description: Auth: Manages SSO email address domain mapping to an SSO Identity Provider.
CREATE TABLE IF NOT EXISTS auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT sso_domains_pkey PRIMARY KEY (id),
    CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES None.None(None)
);
COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';

-- Table: auth.sso_providers
-- Description: Auth: Manages SSO identity provider information; see saml_providers for SAML.
CREATE TABLE IF NOT EXISTS auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT sso_providers_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';
COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';

-- Table: auth.users
-- Description: Auth: Stores user login data within a secure schema.
CREATE TABLE IF NOT EXISTS auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint(16) DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean NOT NULL DEFAULT false,
    deleted_at timestamp with time zone,
    is_anonymous boolean NOT NULL DEFAULT false,
    CONSTRAINT users_phone_key UNIQUE (phone),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';
COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';

-- Table: public.boq_items
-- Description: Элементы позиций заказчика (Bill of Quantities Items)
CREATE TABLE IF NOT EXISTS public.boq_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    client_position_id uuid NOT NULL,
    sort_number integer(32) NOT NULL DEFAULT 0,
    boq_item_type USER-DEFINED NOT NULL,
    material_type USER-DEFINED,
    material_name_id uuid,
    work_name_id uuid,
    unit_code text,
    quantity numeric(18,6),
    base_quantity numeric(18,6),
    consumption_coefficient numeric(10,4),
    conversion_coefficient numeric(10,4),
    delivery_price_type USER-DEFINED,
    delivery_amount numeric(15,5) DEFAULT 0.00000,
    currency_type USER-DEFINED DEFAULT 'RUB'::currency_type,
    total_amount numeric(18,2),
    detail_cost_category_id uuid,
    quote_link text,
    commercial_markup numeric(10,4),
    total_commercial_material_cost numeric(18,6),
    total_commercial_work_cost numeric(18,6),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    parent_work_item_id uuid,
    description text,
    unit_rate numeric(18,2) DEFAULT 0.00,
    CONSTRAINT boq_items_client_position_id_fkey FOREIGN KEY (client_position_id) REFERENCES None.None(None),
    CONSTRAINT boq_items_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES None.None(None),
    CONSTRAINT boq_items_material_name_id_fkey FOREIGN KEY (material_name_id) REFERENCES None.None(None),
    CONSTRAINT boq_items_parent_work_item_id_fkey FOREIGN KEY (parent_work_item_id) REFERENCES public.boq_items(id),
    CONSTRAINT boq_items_pkey PRIMARY KEY (id),
    CONSTRAINT boq_items_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT boq_items_unit_code_fkey FOREIGN KEY (unit_code) REFERENCES None.None(None),
    CONSTRAINT boq_items_work_name_id_fkey FOREIGN KEY (work_name_id) REFERENCES None.None(None),
    CONSTRAINT boq_items_import_session_id_fkey FOREIGN KEY (import_session_id) REFERENCES public.import_sessions(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.boq_items IS 'Элементы позиций заказчика (Bill of Quantities Items)';
COMMENT ON COLUMN public.boq_items.id IS 'Уникальный идентификатор элемента позиции (UUID)';
COMMENT ON COLUMN public.boq_items.tender_id IS 'Привязка к таблице tenders';
COMMENT ON COLUMN public.boq_items.client_position_id IS 'Привязка к таблице client_positions';
COMMENT ON COLUMN public.boq_items.sort_number IS 'Сортировка элементов позиций заказчика';
COMMENT ON COLUMN public.boq_items.boq_item_type IS 'Тип строки в виде enum (мат, суб-мат, мат-комп., раб, суб-раб, раб-комп.)';
COMMENT ON COLUMN public.boq_items.material_type IS 'Тип материала (основной/вспомогательный)';
COMMENT ON COLUMN public.boq_items.material_name_id IS 'Наименование материала, связан с таблицей material_names';
COMMENT ON COLUMN public.boq_items.work_name_id IS 'Наименование работы, связан с таблицей work_names';
COMMENT ON COLUMN public.boq_items.unit_code IS 'Единица измерения, связана с таблицей units';
COMMENT ON COLUMN public.boq_items.quantity IS 'Количество';
COMMENT ON COLUMN public.boq_items.base_quantity IS 'Базовое количество для непривязанного материала к работе';
COMMENT ON COLUMN public.boq_items.consumption_coefficient IS 'Коэффициент расхода материала';
COMMENT ON COLUMN public.boq_items.conversion_coefficient IS 'Коэффициент перевода материала';
COMMENT ON COLUMN public.boq_items.delivery_price_type IS 'Тип доставки (в цене, не в цене, суммой)';
COMMENT ON COLUMN public.boq_items.delivery_amount IS 'Стоимость доставки';
COMMENT ON COLUMN public.boq_items.currency_type IS 'Тип валюты (RUB, USD, EUR, CNY)';
COMMENT ON COLUMN public.boq_items.total_amount IS 'Итоговая сумма';
COMMENT ON COLUMN public.boq_items.detail_cost_category_id IS 'Затрата на строительство, связь с таблицей detail_cost_categories';
COMMENT ON COLUMN public.boq_items.quote_link IS 'Ссылка на КП';
COMMENT ON COLUMN public.boq_items.commercial_markup IS 'Коэффициент наценки';
COMMENT ON COLUMN public.boq_items.total_commercial_material_cost IS 'Коммерческая стоимость материалов с точностью до 6 знаков для минимизации погрешности округления';
COMMENT ON COLUMN public.boq_items.total_commercial_work_cost IS 'Коммерческая стоимость работ с точностью до 6 знаков для минимизации погрешности округления';
COMMENT ON COLUMN public.boq_items.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.boq_items.updated_at IS 'Дата и время последнего обновления';
COMMENT ON COLUMN public.boq_items.parent_work_item_id IS 'Привязка материала к работе (FK к boq_items.id, NULL если материал независимый)';
COMMENT ON COLUMN public.boq_items.description IS 'Примечание к элементу позиции';
COMMENT ON COLUMN public.boq_items.unit_rate IS 'Цена за единицу';
COMMENT ON COLUMN public.boq_items.import_session_id IS 'Ссылка на сессию импорта из Excel (NULL для вручную добавленных элементов)';

-- Table: public.import_sessions
-- Description: Сессии массового импорта BOQ из Excel
CREATE TABLE IF NOT EXISTS public.import_sessions (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid,
    tender_id uuid NOT NULL,
    file_name text,
    items_count integer NOT NULL DEFAULT 0,
    positions_snapshot jsonb,
    imported_at timestamp with time zone NOT NULL DEFAULT now(),
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    CONSTRAINT import_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT import_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT import_sessions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE,
    CONSTRAINT import_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.import_sessions IS 'Сессии массового импорта BOQ из Excel с возможностью отката';
COMMENT ON COLUMN public.import_sessions.positions_snapshot IS 'Snapshot состояния client_positions до импорта (manual_volume, manual_note) для восстановления при отмене';
COMMENT ON COLUMN public.import_sessions.items_count IS 'Количество вставленных boq_items в рамках сессии';
COMMENT ON COLUMN public.import_sessions.cancelled_at IS 'Дата и время отмены импорта (NULL = активная сессия)';
COMMENT ON COLUMN public.import_sessions.cancelled_by IS 'Кто отменил импорт';

-- Table: public.boq_items_audit
-- Description: История изменений BOQ items с полным snapshot данных
CREATE TABLE IF NOT EXISTS public.boq_items_audit (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    boq_item_id uuid NOT NULL,
    operation_type text NOT NULL,
    changed_at timestamp with time zone NOT NULL DEFAULT now(),
    changed_by uuid,
    old_data jsonb,
    new_data jsonb,
    changed_fields ARRAY,
    CONSTRAINT boq_items_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES None.None(None),
    CONSTRAINT boq_items_audit_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.boq_items_audit IS 'История изменений BOQ items с полным snapshot данных';
COMMENT ON COLUMN public.boq_items_audit.boq_item_id IS 'ID удаленного элемента (хранится без FK constraint для сохранения истории после удаления)';
COMMENT ON COLUMN public.boq_items_audit.operation_type IS 'Тип операции: INSERT, UPDATE, DELETE';
COMMENT ON COLUMN public.boq_items_audit.changed_at IS 'Дата и время изменения';
COMMENT ON COLUMN public.boq_items_audit.changed_by IS 'Пользователь, совершивший изменение (из таблицы users)';
COMMENT ON COLUMN public.boq_items_audit.old_data IS 'Snapshot данных до изменения (для UPDATE и DELETE)';
COMMENT ON COLUMN public.boq_items_audit.new_data IS 'Snapshot данных после изменения (для INSERT и UPDATE)';
COMMENT ON COLUMN public.boq_items_audit.changed_fields IS 'Массив названий измененных полей (только для UPDATE)';

-- Table: public.client_positions
-- Description: Позиции заказчика из ВОРа (Bill of Quantities)
CREATE TABLE IF NOT EXISTS public.client_positions (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    position_number numeric(10,2) NOT NULL,
    unit_code text,
    volume numeric(18,6),
    client_note text,
    item_no text,
    work_name text NOT NULL,
    manual_volume numeric(18,6),
    manual_note text,
    hierarchy_level integer(32) DEFAULT 0,
    is_additional boolean DEFAULT false,
    parent_position_id uuid,
    total_material numeric(18,2) DEFAULT 0,
    total_works numeric(18,2) DEFAULT 0,
    material_cost_per_unit numeric(18,6) DEFAULT 0,
    work_cost_per_unit numeric(18,6) DEFAULT 0,
    total_commercial_material numeric(18,6) DEFAULT 0,
    total_commercial_work numeric(18,6) DEFAULT 0,
    total_commercial_material_per_unit numeric(18,6) DEFAULT 0,
    total_commercial_work_per_unit numeric(18,6) DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT client_positions_parent_position_id_fkey FOREIGN KEY (parent_position_id) REFERENCES public.client_positions(id),
    CONSTRAINT client_positions_pkey PRIMARY KEY (id),
    CONSTRAINT client_positions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT client_positions_unit_code_fkey FOREIGN KEY (unit_code) REFERENCES None.None(None)
);
COMMENT ON TABLE public.client_positions IS 'Позиции заказчика из ВОРа (Bill of Quantities)';
COMMENT ON COLUMN public.client_positions.id IS 'Уникальный идентификатор позиции';
COMMENT ON COLUMN public.client_positions.tender_id IS 'Связь с тендером';
COMMENT ON COLUMN public.client_positions.position_number IS 'Номер позиции, поддерживает decimal для дополнительных работ (например: 5.1, 5.2)';
COMMENT ON COLUMN public.client_positions.unit_code IS 'Код единицы измерения (ссылка на units.code)';
COMMENT ON COLUMN public.client_positions.volume IS 'Объем заказчика';
COMMENT ON COLUMN public.client_positions.client_note IS 'Примечание заказчика';
COMMENT ON COLUMN public.client_positions.item_no IS 'Номер раздела заказчика (из файла ВОР)';
COMMENT ON COLUMN public.client_positions.work_name IS 'Название работы/позиции';
COMMENT ON COLUMN public.client_positions.manual_volume IS 'Количество ГП (ручной ввод)';
COMMENT ON COLUMN public.client_positions.manual_note IS 'Примечание ГП (ручной ввод)';
COMMENT ON COLUMN public.client_positions.hierarchy_level IS 'Уровень в иерархии (вводится вручную)';
COMMENT ON COLUMN public.client_positions.is_additional IS 'Признак дополнительной строки';
COMMENT ON COLUMN public.client_positions.parent_position_id IS 'Связь с родительской позицией для доп. строк';
COMMENT ON COLUMN public.client_positions.total_material IS 'Прямая стоимость материалов (расчетная)';
COMMENT ON COLUMN public.client_positions.total_works IS 'Прямая стоимость работ (расчетная)';
COMMENT ON COLUMN public.client_positions.material_cost_per_unit IS 'Стоимость материалов за единицу';
COMMENT ON COLUMN public.client_positions.work_cost_per_unit IS 'Стоимость работ за единицу';
COMMENT ON COLUMN public.client_positions.total_commercial_material IS 'Коммерческая стоимость материалов с наценками';
COMMENT ON COLUMN public.client_positions.total_commercial_work IS 'Коммерческая стоимость работ с наценками';
COMMENT ON COLUMN public.client_positions.total_commercial_material_per_unit IS 'Коммерческая стоимость материалов за единицу';
COMMENT ON COLUMN public.client_positions.total_commercial_work_per_unit IS 'Коммерческая стоимость работ за единицу';
COMMENT ON COLUMN public.client_positions.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.client_positions.updated_at IS 'Дата и время последнего обновления записи';

-- Table: public.construction_cost_volumes
-- Description: Объемы затрат по тендерам (детальные категории и 

  группы)
CREATE TABLE IF NOT EXISTS public.construction_cost_volumes (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid,
    volume numeric(18,6) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_key text,
    CONSTRAINT construction_cost_volumes_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES None.None(None),
    CONSTRAINT construction_cost_volumes_pkey PRIMARY KEY (id),
    CONSTRAINT construction_cost_volumes_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None)
);
COMMENT ON TABLE public.construction_cost_volumes IS 'Объемы затрат по тендерам (детальные категории и 

  группы)';
COMMENT ON COLUMN public.construction_cost_volumes.detail_cost_category_id IS 'ID детальной категории 

  затрат (для деталей)';
COMMENT ON COLUMN public.construction_cost_volumes.group_key IS 'Ключ группы в формате 

  category-{название} или location-{категория}-{локализация} (для групп)';

-- Table: public.cost_categories
-- Description: Справочник      

  категорий затрат
CREATE TABLE IF NOT EXISTS public.cost_categories (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cost_categories_pkey PRIMARY KEY (id),
    CONSTRAINT cost_categories_unit_fkey FOREIGN KEY (unit) REFERENCES None.None(None)
);
COMMENT ON TABLE public.cost_categories IS 'Справочник      

  категорий затрат';
COMMENT ON COLUMN public.cost_categories.id IS 'Уникальный идентификатор категории (UUID)';
COMMENT ON COLUMN public.cost_categories.name IS 'Наименование категории затрат';
COMMENT ON COLUMN public.cost_categories.unit IS 'Единица измерения категории';
COMMENT ON COLUMN public.cost_categories.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.cost_categories.updated_at IS 'Дата и время последнего обновления';

-- Table: public.cost_redistribution_results
-- Description: Результаты перераспределения стоимости работ между затратами на строительство.

    Хранит финансовые данные после перераспределения и правила для воспроизводимости расчета.
CREATE TABLE IF NOT EXISTS public.cost_redistribution_results (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    markup_tactic_id uuid NOT NULL,
    boq_item_id uuid NOT NULL,
    original_work_cost numeric(18,2),
    deducted_amount numeric(18,2) NOT NULL DEFAULT 0,
    added_amount numeric(18,2) NOT NULL DEFAULT 0,
    final_work_cost numeric(18,2),
    redistribution_rules jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by uuid,
    CONSTRAINT cost_redistribution_results_boq_item_id_fkey FOREIGN KEY (boq_item_id) REFERENCES None.None(None),
    CONSTRAINT cost_redistribution_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES None.None(None),
    CONSTRAINT cost_redistribution_results_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES None.None(None),
    CONSTRAINT cost_redistribution_results_pkey PRIMARY KEY (id),
    CONSTRAINT cost_redistribution_results_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT uq_cost_redistribution_results_tender_tactic_boq UNIQUE (boq_item_id),
    CONSTRAINT uq_cost_redistribution_results_tender_tactic_boq UNIQUE (markup_tactic_id),
    CONSTRAINT uq_cost_redistribution_results_tender_tactic_boq UNIQUE (tender_id)
);
COMMENT ON TABLE public.cost_redistribution_results IS 'Результаты перераспределения стоимости работ между затратами на строительство.

    Хранит финансовые данные после перераспределения и правила для воспроизводимости расчета.';
COMMENT ON COLUMN public.cost_redistribution_results.id IS 'Уникальный идентификатор записи результата';
COMMENT ON COLUMN public.cost_redistribution_results.tender_id IS 'Ссылка на тендер';
COMMENT ON COLUMN public.cost_redistribution_results.markup_tactic_id IS 'Ссылка на тактику наценок';
COMMENT ON COLUMN public.cost_redistribution_results.boq_item_id IS 'Ссылка на элемент BOQ (работа)';
COMMENT ON COLUMN public.cost_redistribution_results.original_work_cost IS 'Исходная стоимость работы до перераспределения';
COMMENT ON COLUMN public.cost_redistribution_results.deducted_amount IS 'Сумма, вычтенная из стоимости работы';
COMMENT ON COLUMN public.cost_redistribution_results.added_amount IS 'Сумма, добавленная к стоимости работы';
COMMENT ON COLUMN public.cost_redistribution_results.final_work_cost IS 'Финальная стоимость работы после перераспределения';
COMMENT ON COLUMN public.cost_redistribution_results.redistribution_rules IS 'JSONB с правилами вычитания и целевыми затратами для воспроизводимости расчета.

    Формат: {

        "deductions": [

            {"detail_cost_category_id": "uuid", "category_name": "...", "percentage": 10}

        ],

        "targets": [

            {"detail_cost_category_id": "uuid", "category_name": "...", "weight": 1.0}

        ]

    }';
COMMENT ON COLUMN public.cost_redistribution_results.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.cost_redistribution_results.updated_at IS 'Дата и время последнего обновления записи';
COMMENT ON COLUMN public.cost_redistribution_results.created_by IS 'Пользователь, создавший запись';

-- Table: public.detail_cost_categories
-- Description: Детальные категории затрат по локациям
CREATE TABLE IF NOT EXISTS public.detail_cost_categories (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    cost_category_id uuid NOT NULL,
    location text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    order_num integer(32) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT detail_cost_categories_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES None.None(None),
    CONSTRAINT detail_cost_categories_pkey PRIMARY KEY (id),
    CONSTRAINT detail_cost_categories_unit_fkey FOREIGN KEY (unit) REFERENCES None.None(None)
);
COMMENT ON TABLE public.detail_cost_categories IS 'Детальные категории затрат по локациям';
COMMENT ON COLUMN public.detail_cost_categories.id IS 'Уникальный идентификатор детальной категории (UUID)';
COMMENT ON COLUMN public.detail_cost_categories.cost_category_id IS 'Ссылка на категорию затрат';
COMMENT ON COLUMN public.detail_cost_categories.location IS 'Локация/местоположение';
COMMENT ON COLUMN public.detail_cost_categories.name IS 'Наименование детальной категории';
COMMENT ON COLUMN public.detail_cost_categories.unit IS 'Единица измерения';
COMMENT ON COLUMN public.detail_cost_categories.order_num IS 'Порядковый      

  номер для сортировки';
COMMENT ON COLUMN public.detail_cost_categories.created_at IS 'Дата и

  время создания записи';
COMMENT ON COLUMN public.detail_cost_categories.updated_at IS 'Дата и

  время последнего обновления';

-- Table: public.markup_parameters
-- Description: Справочник параметров наценок
CREATE TABLE IF NOT EXISTS public.markup_parameters (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    key text NOT NULL,
    label text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    order_num integer(32) NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    default_value numeric(5,2) NOT NULL DEFAULT 0,
    CONSTRAINT markup_parameters_key_key UNIQUE (key),
    CONSTRAINT markup_parameters_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.markup_parameters IS 'Справочник параметров наценок';
COMMENT ON COLUMN public.markup_parameters.id IS 'Уникальный идентификатор параметра';
COMMENT ON COLUMN public.markup_parameters.key IS 'Ключ параметра (snake_case с цифрами, уникальный)';
COMMENT ON COLUMN public.markup_parameters.label IS 'Название параметра (для UI)';
COMMENT ON COLUMN public.markup_parameters.is_active IS 'Активен ли параметр';
COMMENT ON COLUMN public.markup_parameters.order_num IS 'Порядок отображения';
COMMENT ON COLUMN public.markup_parameters.created_at IS 'Дата создания';
COMMENT ON COLUMN public.markup_parameters.updated_at IS 'Дата последнего обновления';
COMMENT ON COLUMN public.markup_parameters.default_value IS 'Базовое (глобальное) значение процента по умолчанию. Используется при создании новых тендеров и как значение по умолчанию в интерфейсе.';

-- Table: public.markup_tactics
-- Description: Хранение тактик наценок для конструктора наценок
CREATE TABLE IF NOT EXISTS public.markup_tactics (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text,
    sequences jsonb NOT NULL DEFAULT '{"мат": [], "раб": [], "суб-мат": [], "суб-раб": [], "мат-комп.": [], "раб-комп.": []}'::jsonb,
    base_costs jsonb NOT NULL DEFAULT '{"мат": 0, "раб": 0, "суб-мат": 0, "суб-раб": 0, "мат-комп.": 0, "раб-комп.": 0}'::jsonb,
    user_id uuid,
    is_global boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT markup_tactics_pkey PRIMARY KEY (id),
    CONSTRAINT markup_tactics_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE public.markup_tactics IS 'Хранение тактик наценок для конструктора наценок';
COMMENT ON COLUMN public.markup_tactics.sequences IS 'JSON с последовательностями операций наценок для каждого типа позиций';
COMMENT ON COLUMN public.markup_tactics.base_costs IS 'JSON с базовыми стоимостями для каждого типа позиций';
COMMENT ON COLUMN public.markup_tactics.is_global IS 'Глобальная тактика, доступная всем пользователям';

-- Table: public.material_names
-- Description: Справочник наименований материалов
CREATE TABLE IF NOT EXISTS public.material_names (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT material_names_pkey PRIMARY KEY (id),
    CONSTRAINT material_names_unit_fkey FOREIGN KEY (unit) REFERENCES None.None(None)
);
COMMENT ON TABLE public.material_names IS 'Справочник наименований материалов';
COMMENT ON COLUMN public.material_names.id IS 'Уникальный идентификатор материала (UUID)';
COMMENT ON COLUMN public.material_names.name IS 'Наименование материала';
COMMENT ON COLUMN public.material_names.unit IS 'Единица измерения материала';
COMMENT ON COLUMN public.material_names.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.material_names.updated_at IS 'Дата и время последнего обновления';

-- Table: public.materials_library
-- Description: Справочник материалов (Material library) с полной детализацией
CREATE TABLE IF NOT EXISTS public.materials_library (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    material_type USER-DEFINED NOT NULL,
    item_type USER-DEFINED NOT NULL,
    consumption_coefficient numeric(10,4) DEFAULT 1.0000,
    unit_rate numeric(15,2) NOT NULL,
    currency_type USER-DEFINED NOT NULL DEFAULT 'RUB'::currency_type,
    delivery_price_type USER-DEFINED NOT NULL DEFAULT 'в цене'::delivery_price_type,
    delivery_amount numeric(15,5) DEFAULT 0.00000,
    material_name_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT materials_library_material_name_id_fkey FOREIGN KEY (material_name_id) REFERENCES None.None(None),
    CONSTRAINT materials_library_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.materials_library IS 'Справочник материалов (Material library) с полной детализацией';
COMMENT ON COLUMN public.materials_library.id IS 'Уникальный идентификатор работы (UUID)';
COMMENT ON COLUMN public.materials_library.material_type IS 'Тип материала (основной/вспомогательный)';
COMMENT ON COLUMN public.materials_library.item_type IS 'Вид материала (мат, суб-мат, мат-комп)';
COMMENT ON COLUMN public.materials_library.consumption_coefficient IS 'Коэффициент расхода';
COMMENT ON COLUMN public.materials_library.unit_rate IS 'Цена материала за единицу';
COMMENT ON COLUMN public.materials_library.currency_type IS 'Тип валюты (рубли, евро, доллары, юани)';
COMMENT ON COLUMN public.materials_library.delivery_price_type IS 'Тип доставки (в цене, не в цене, суммой)';
COMMENT ON COLUMN public.materials_library.delivery_amount IS 'Сумма доставки';
COMMENT ON COLUMN public.materials_library.material_name_id IS 'Связь с наименованием материала (откуда берется название и единица измерения)';
COMMENT ON COLUMN public.materials_library.created_at IS 'Дата создания';
COMMENT ON COLUMN public.materials_library.updated_at IS 'Дата изменения';

-- Table: public.notifications
-- Description: Системные уведомления для пользователей
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    related_entity_type text,
    related_entity_id uuid,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.notifications IS 'Системные уведомления для пользователей';
COMMENT ON COLUMN public.notifications.id IS 'Уникальный идентификатор уведомления';
COMMENT ON COLUMN public.notifications.type IS 'Тип уведомления (success, info, warning, pending)';
COMMENT ON COLUMN public.notifications.title IS 'Заголовок уведомления';
COMMENT ON COLUMN public.notifications.message IS 'Текст уведомления';
COMMENT ON COLUMN public.notifications.related_entity_type IS 'Тип связанной сущности (tender, position, cost, etc.)';
COMMENT ON COLUMN public.notifications.related_entity_id IS 'ID связанной сущности';
COMMENT ON COLUMN public.notifications.is_read IS 'Признак прочтения уведомления';
COMMENT ON COLUMN public.notifications.created_at IS 'Дата и время создания';

-- Table: public.roles
-- Description: Role definitions with permissions
CREATE TABLE IF NOT EXISTS public.roles (
    code text NOT NULL,
    name text NOT NULL,
    allowed_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_system_role boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    color text DEFAULT 'default'::text,
    CONSTRAINT roles_name_key UNIQUE (name),
    CONSTRAINT roles_pkey PRIMARY KEY (code)
);
COMMENT ON TABLE public.roles IS 'Role definitions with permissions';
COMMENT ON COLUMN public.roles.code IS 'Role code identifier (e.g., administrator, engineer)';
COMMENT ON COLUMN public.roles.name IS 'Human-readable role name in Russian';
COMMENT ON COLUMN public.roles.allowed_pages IS 'Array of allowed page paths for this role. Empty array means full access.';
COMMENT ON COLUMN public.roles.is_system_role IS 'System roles cannot be deleted';
COMMENT ON COLUMN public.roles.color IS 'Ant Design tag color for the role

  (e.g., blue, green, purple, etc.)';

-- Table: public.subcontract_growth_exclusions
-- Description: Исключения роста субподряда для категорий затрат
CREATE TABLE IF NOT EXISTS public.subcontract_growth_exclusions (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    exclusion_type text NOT NULL DEFAULT 'works'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subcontract_growth_exclusions_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES None.None(None),
    CONSTRAINT subcontract_growth_exclusions_pkey PRIMARY KEY (id),
    CONSTRAINT subcontract_growth_exclusions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT subcontract_growth_exclusions_unique UNIQUE (detail_cost_category_id),
    CONSTRAINT subcontract_growth_exclusions_unique UNIQUE (exclusion_type),
    CONSTRAINT subcontract_growth_exclusions_unique UNIQUE (tender_id)
);
COMMENT ON TABLE public.subcontract_growth_exclusions IS 'Исключения роста субподряда для категорий затрат';
COMMENT ON COLUMN public.subcontract_growth_exclusions.exclusion_type IS 'Тип исключения: works (суб-раб) или materials (суб-мат)';

-- Table: public.template_items
CREATE TABLE IF NOT EXISTS public.template_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL,
    kind text NOT NULL,
    work_library_id uuid,
    material_library_id uuid,
    parent_work_item_id uuid,
    conversation_coeff numeric(18,6),
    position integer(32) NOT NULL DEFAULT 0,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    detail_cost_category_id uuid,
    CONSTRAINT template_items_detail_cost_category_fk FOREIGN KEY (detail_cost_category_id) REFERENCES None.None(None),
    CONSTRAINT template_items_material_library_fk FOREIGN KEY (material_library_id) REFERENCES None.None(None),
    CONSTRAINT template_items_parent_work_item_fk FOREIGN KEY (parent_work_item_id) REFERENCES public.template_items(id),
    CONSTRAINT template_items_pkey PRIMARY KEY (id),
    CONSTRAINT template_items_template_fk FOREIGN KEY (template_id) REFERENCES None.None(None),
    CONSTRAINT template_items_work_library_fk FOREIGN KEY (work_library_id) REFERENCES None.None(None)
);

-- Table: public.templates
CREATE TABLE IF NOT EXISTS public.templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT templates_detail_cost_category_fk FOREIGN KEY (detail_cost_category_id) REFERENCES None.None(None),
    CONSTRAINT templates_pkey PRIMARY KEY (id)
);

-- Table: public.tender_documents
-- Description: Проектная документация в markdown. RLS отключен для development.
CREATE TABLE IF NOT EXISTS public.tender_documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    section_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    original_filename character varying(255),
    content_markdown text NOT NULL,
    file_size bigint(64),
    upload_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tender_documents_pkey PRIMARY KEY (id),
    CONSTRAINT tender_documents_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT unique_tender_section_file UNIQUE (original_filename),
    CONSTRAINT unique_tender_section_file UNIQUE (section_type),
    CONSTRAINT unique_tender_section_file UNIQUE (tender_id)
);
COMMENT ON TABLE public.tender_documents IS 'Проектная документация в markdown. RLS отключен для development.';
COMMENT ON COLUMN public.tender_documents.section_type IS 'Раздел проектной документации: АР (архитектурные решения), КР (конструктивные решения), ИОС, ТХ, ПОС и т.д.';
COMMENT ON COLUMN public.tender_documents.original_filename IS 'Имя загруженного файла для отладки и логов';
COMMENT ON COLUMN public.tender_documents.content_markdown IS 'Полный текст документа в markdown формате после конвертации из PDF/DOCX';

-- Table: public.tender_markup_percentage
-- Description: Проценты наценок по тендерам (связь с справочником параметров)
CREATE TABLE IF NOT EXISTS public.tender_markup_percentage (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    markup_parameter_id uuid NOT NULL,
    value numeric(8,5) NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tender_markup_percentage_markup_parameter_id_fkey FOREIGN KEY (markup_parameter_id) REFERENCES None.None(None),
    CONSTRAINT tender_markup_percentage_pkey PRIMARY KEY (id),
    CONSTRAINT tender_markup_percentage_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT tender_markup_percentage_unique UNIQUE (markup_parameter_id),
    CONSTRAINT tender_markup_percentage_unique UNIQUE (tender_id)
);
COMMENT ON TABLE public.tender_markup_percentage IS 'Проценты наценок по тендерам (связь с справочником параметров)';
COMMENT ON COLUMN public.tender_markup_percentage.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN public.tender_markup_percentage.tender_id IS 'Ссылка на тендер';
COMMENT ON COLUMN public.tender_markup_percentage.markup_parameter_id IS 'Ссылка на параметр наценки';
COMMENT ON COLUMN public.tender_markup_percentage.value IS 'Значение процента (0-999.99999) с точностью до 5 знаков после запятой';
COMMENT ON COLUMN public.tender_markup_percentage.created_at IS 'Дата создания';
COMMENT ON COLUMN public.tender_markup_percentage.updated_at IS 'Дата последнего обновления';

-- Table: public.tender_pricing_distribution
-- Description: Правила распределения затрат и наценок между КП (материалы) и работами для каждого        

  тендера
CREATE TABLE IF NOT EXISTS public.tender_pricing_distribution (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    markup_tactic_id uuid,
    basic_material_base_target text NOT NULL DEFAULT 'material'::text,
    basic_material_markup_target text NOT NULL DEFAULT 'work'::text,
    auxiliary_material_base_target text NOT NULL DEFAULT 'work'::text,
    auxiliary_material_markup_target text NOT NULL DEFAULT 'work'::text,
    work_base_target text NOT NULL DEFAULT 'work'::text,
    work_markup_target text NOT NULL DEFAULT 'work'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    subcontract_basic_material_base_target text NOT NULL DEFAULT 'work'::text,
    subcontract_basic_material_markup_target text NOT NULL DEFAULT 'work'::text,
    subcontract_auxiliary_material_base_target text NOT NULL DEFAULT 'work'::text,
    subcontract_auxiliary_material_markup_target text NOT NULL DEFAULT 'work'::text,
    component_material_base_target text NOT NULL DEFAULT 'work'::text,
    component_material_markup_target text NOT NULL DEFAULT 'work'::text,
    component_work_base_target text NOT NULL DEFAULT 'work'::text,
    component_work_markup_target text NOT NULL DEFAULT 'work'::text,
    CONSTRAINT tender_pricing_distribution_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES None.None(None),
    CONSTRAINT tender_pricing_distribution_pkey PRIMARY KEY (id),
    CONSTRAINT tender_pricing_distribution_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT tender_pricing_distribution_tender_id_markup_tactic_id_key UNIQUE (markup_tactic_id),
    CONSTRAINT tender_pricing_distribution_tender_id_markup_tactic_id_key UNIQUE (tender_id)
);
COMMENT ON TABLE public.tender_pricing_distribution IS 'Правила распределения затрат и наценок между КП (материалы) и работами для каждого        

  тендера';
COMMENT ON COLUMN public.tender_pricing_distribution.basic_material_base_target IS 'Куда направляется базовая стоимость основных материалов: material = КП, work =

  работы';
COMMENT ON COLUMN public.tender_pricing_distribution.basic_material_markup_target IS 'Куда направляется наценка на основные материалы: material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.auxiliary_material_base_target IS 'Куда направляется базовая стоимость вспомогательных материалов: material = КП, work =     

  работы';
COMMENT ON COLUMN public.tender_pricing_distribution.auxiliary_material_markup_target IS 'Куда направляется наценка на вспомогательные материалы: material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.work_base_target IS 'Куда направляется базовая стоимость работ: material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.work_markup_target IS 'Куда направляется наценка на работы: material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.component_material_base_target IS 'Куда направляется базовая стоимость компонентных материалов (мат-комп.): material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.component_material_markup_target IS 'Куда направляется наценка на компонентные материалы (мат-комп.): material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.component_work_base_target IS 'Куда направляется базовая стоимость компонентных работ (раб-комп.): material = КП, work = работы';
COMMENT ON COLUMN public.tender_pricing_distribution.component_work_markup_target IS 'Куда направляется наценка на компонентные работы (раб-комп.): material = КП, work = работы';

-- Table: public.tenders
-- Description: Основная таблица для хранения информации о тендерах
CREATE TABLE IF NOT EXISTS public.tenders (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    title text NOT NULL,
    description text,
    client_name text NOT NULL,
    tender_number text NOT NULL,
    submission_deadline timestamp with time zone,
    version integer(32) DEFAULT 1,
    area_client numeric(12,2),
    area_sp numeric(12,2),
    usd_rate numeric(10,4),
    eur_rate numeric(10,4),
    cny_rate numeric(10,4),
    upload_folder text,
    bsm_link text,
    tz_link text,
    qa_form_link text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    markup_tactic_id uuid,
    apply_subcontract_works_growth boolean DEFAULT true,
    apply_subcontract_materials_growth boolean DEFAULT true,
    housing_class USER-DEFINED,
    construction_scope USER-DEFINED,
    project_folder_link text,
    is_archived boolean NOT NULL DEFAULT false,
    volume_title text DEFAULT 'Полный объём строительства'::text,
    CONSTRAINT tenders_created_by_fkey FOREIGN KEY (created_by) REFERENCES None.None(None),
    CONSTRAINT tenders_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES None.None(None),
    CONSTRAINT tenders_pkey PRIMARY KEY (id),
    CONSTRAINT tenders_tender_number_version_key UNIQUE (tender_number),
    CONSTRAINT tenders_tender_number_version_key UNIQUE (version)
);
COMMENT ON TABLE public.tenders IS 'Основная таблица для хранения информации о тендерах';
COMMENT ON COLUMN public.tenders.id IS 'Уникальный идентификатор тендера (UUID)';
COMMENT ON COLUMN public.tenders.title IS 'Название тендера';
COMMENT ON COLUMN public.tenders.description IS 'Подробное описание тендера';
COMMENT ON COLUMN public.tenders.client_name IS 'Наименование заказчика';
COMMENT ON COLUMN public.tenders.tender_number IS 'Номер тендера (уникальный, текст+цифры)';
COMMENT ON COLUMN public.tenders.submission_deadline IS 'Дата и время окончания приема заявок';
COMMENT ON COLUMN public.tenders.version IS 'Версия тендера';
COMMENT ON COLUMN public.tenders.area_client IS 'Площадь объекта заказчика (м²)';
COMMENT ON COLUMN public.tenders.area_sp IS 'Площадь СП (м²)';
COMMENT ON COLUMN public.tenders.usd_rate IS 'Курс доллара США';
COMMENT ON COLUMN public.tenders.eur_rate IS 'Курс евро';
COMMENT ON COLUMN public.tenders.cny_rate IS 'Курс китайского юаня';
COMMENT ON COLUMN public.tenders.upload_folder IS 'Ссылка на папку с загруженными файлами';
COMMENT ON COLUMN public.tenders.bsm_link IS 'Ссылка на БСМ (Bill of Materials)';
COMMENT ON COLUMN public.tenders.tz_link IS 'Ссылка на техническое задание';
COMMENT ON COLUMN public.tenders.qa_form_link IS 'Ссылка на форму вопросов и ответов';
COMMENT ON COLUMN public.tenders.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.tenders.updated_at IS 'Дата и время последнего обновления';
COMMENT ON COLUMN public.tenders.created_by IS 'ID пользователя, создавшего тендер';
COMMENT ON COLUMN public.tenders.markup_tactic_id IS 'Ссылка на тактику наценок для данного тендера';
COMMENT ON COLUMN public.tenders.apply_subcontract_works_growth IS 'Применять ли рост стоимости для субподрядных работ (суб-раб)';
COMMENT ON COLUMN public.tenders.apply_subcontract_materials_growth IS 'Применять ли рост стоимости для субподрядных материалов (суб-мат)';
COMMENT ON COLUMN public.tenders.housing_class IS 'Класс жилья (комфорт, бизнес, премиум, делюкс)';
COMMENT ON COLUMN public.tenders.construction_scope IS 'Объем строительства (генподряд, коробка, монолит)';
COMMENT ON COLUMN public.tenders.project_folder_link IS 'Ссылка на папку с проектом';
COMMENT ON COLUMN public.tenders.is_archived IS 'Флаг архивации тендера';
COMMENT ON COLUMN public.tenders.volume_title IS 'Пользовательский заголовок для объема строительства на странице финансовых показателей';

-- Table: public.units
CREATE TABLE IF NOT EXISTS public.units (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    sort_order integer(32) DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT units_pkey PRIMARY KEY (code)
);

-- Table: public.user_position_filters
-- Description: Персональные фильтры позиций заказчика для каждого пользователя. Используется для сохранения выбранных позиций при фильтрации на странице /positions.
CREATE TABLE IF NOT EXISTS public.user_position_filters (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    tender_id uuid NOT NULL,
    position_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT unique_user_tender_position UNIQUE (position_id),
    CONSTRAINT unique_user_tender_position UNIQUE (tender_id),
    CONSTRAINT unique_user_tender_position UNIQUE (user_id),
    CONSTRAINT user_position_filters_pkey PRIMARY KEY (id),
    CONSTRAINT user_position_filters_position_id_fkey FOREIGN KEY (position_id) REFERENCES None.None(None),
    CONSTRAINT user_position_filters_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT user_position_filters_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE public.user_position_filters IS 'Персональные фильтры позиций заказчика для каждого пользователя. Используется для сохранения выбранных позиций при фильтрации на странице /positions.';
COMMENT ON COLUMN public.user_position_filters.user_id IS 'ID пользователя, которому принадлежит фильтр';
COMMENT ON COLUMN public.user_position_filters.tender_id IS 'ID тендера, к которому относится фильтр';
COMMENT ON COLUMN public.user_position_filters.position_id IS 'ID позиции заказчика, включенной в фильтр';
COMMENT ON COLUMN public.user_position_filters.created_at IS 'Дата и время добавления позиции в фильтр';

-- Table: public.user_tasks
-- Description: Задачи пользователей по тендерам
CREATE TABLE IF NOT EXISTS public.user_tasks (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    tender_id uuid NOT NULL,
    description text NOT NULL,
    task_status USER-DEFINED DEFAULT 'running'::task_status,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT user_tasks_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES None.None(None),
    CONSTRAINT user_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES None.None(None)
);
COMMENT ON TABLE public.user_tasks IS 'Задачи пользователей по тендерам';
COMMENT ON COLUMN public.user_tasks.task_status IS 'Статус задачи: running (в работе), paused (остановлена),

  completed (завершена)';

-- Table: public.users
-- Description: Auth: Stores user login data within a secure schema.
CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    access_status USER-DEFINED NOT NULL DEFAULT 'pending'::access_status_type,
    approved_by uuid,
    approved_at timestamp with time zone,
    registration_date timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    access_enabled boolean DEFAULT true,
    role_code text NOT NULL,
    allowed_pages jsonb DEFAULT '[]'::jsonb,
    tender_deadline_extensions jsonb DEFAULT '[]'::jsonb,
    current_work_mode USER-DEFINED DEFAULT 'office'::work_mode,
    current_work_status USER-DEFINED DEFAULT 'working'::work_status,
    CONSTRAINT fk_users_auth_users FOREIGN KEY (id) REFERENCES None.None(None),
    CONSTRAINT users_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_role_code_fkey FOREIGN KEY (role_code) REFERENCES None.None(None)
);
COMMENT ON TABLE public.users IS 'Auth: Stores user login data within a secure schema.';

-- Table: public.work_names
-- Description: Справочник наименований работ
CREATE TABLE IF NOT EXISTS public.work_names (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT work_names_pkey PRIMARY KEY (id),
    CONSTRAINT work_names_unit_fkey FOREIGN KEY (unit) REFERENCES None.None(None)
);
COMMENT ON TABLE public.work_names IS 'Справочник наименований работ';
COMMENT ON COLUMN public.work_names.id IS 'Уникальный идентификатор работы (UUID)';
COMMENT ON COLUMN public.work_names.name IS 'Наименование работы';
COMMENT ON COLUMN public.work_names.unit IS 'Единица измерения работы';
COMMENT ON COLUMN public.work_names.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.work_names.updated_at IS 'Дата и время последнего обновления';

-- Table: public.works_library
-- Description: Справочник работ (Works library) с полной детализацией
CREATE TABLE IF NOT EXISTS public.works_library (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    work_name_id uuid NOT NULL,
    item_type USER-DEFINED NOT NULL,
    unit_rate numeric(15,2) NOT NULL,
    currency_type USER-DEFINED NOT NULL DEFAULT 'RUB'::currency_type,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT works_library_pkey PRIMARY KEY (id),
    CONSTRAINT works_library_work_name_id_fkey FOREIGN KEY (work_name_id) REFERENCES None.None(None)
);
COMMENT ON TABLE public.works_library IS 'Справочник работ (Works library) с полной детализацией';
COMMENT ON COLUMN public.works_library.id IS 'Уникальный идентификатор работы (UUID)';
COMMENT ON COLUMN public.works_library.work_name_id IS 'Связь с наименованием работы (откуда берется название и единица измерения)';
COMMENT ON COLUMN public.works_library.item_type IS 'Категория работы (раб/суб-раб/раб-комп.)';
COMMENT ON COLUMN public.works_library.unit_rate IS 'Цена за единицу измерения';
COMMENT ON COLUMN public.works_library.currency_type IS 'Тип валюты (RUB/USD/EUR/CNY)';
COMMENT ON COLUMN public.works_library.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN public.works_library.updated_at IS 'Дата и время последнего обновления';

-- Table: realtime.messages
CREATE TABLE IF NOT EXISTS realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_pkey PRIMARY KEY (id),
    CONSTRAINT messages_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2025_12_27
CREATE TABLE IF NOT EXISTS realtime.messages_2025_12_27 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2025_12_27_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2025_12_27_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2025_12_28
CREATE TABLE IF NOT EXISTS realtime.messages_2025_12_28 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2025_12_28_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2025_12_28_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2025_12_29
CREATE TABLE IF NOT EXISTS realtime.messages_2025_12_29 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2025_12_29_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2025_12_29_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2025_12_30
CREATE TABLE IF NOT EXISTS realtime.messages_2025_12_30 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2025_12_30_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2025_12_30_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2025_12_31
CREATE TABLE IF NOT EXISTS realtime.messages_2025_12_31 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2025_12_31_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2025_12_31_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2026_01_01
CREATE TABLE IF NOT EXISTS realtime.messages_2026_01_01 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2026_01_01_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2026_01_01_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.messages_2026_01_02
CREATE TABLE IF NOT EXISTS realtime.messages_2026_01_02 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    inserted_at timestamp without time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT messages_2026_01_02_pkey PRIMARY KEY (id),
    CONSTRAINT messages_2026_01_02_pkey PRIMARY KEY (inserted_at)
);

-- Table: realtime.schema_migrations
-- Description: Auth: Manages updates to the auth system.
CREATE TABLE IF NOT EXISTS realtime.schema_migrations (
    version bigint(64) NOT NULL,
    inserted_at timestamp without time zone,
    CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);
COMMENT ON TABLE realtime.schema_migrations IS 'Auth: Manages updates to the auth system.';

-- Table: realtime.subscription
CREATE TABLE IF NOT EXISTS realtime.subscription (
    id bigint(64) NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters ARRAY NOT NULL DEFAULT '{}'::realtime.user_defined_filter[],
    claims jsonb NOT NULL,
    claims_role regrole NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT pk_subscription PRIMARY KEY (id)
);

-- Table: storage.buckets
CREATE TABLE IF NOT EXISTS storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint(64),
    allowed_mime_types ARRAY,
    owner_id text,
    type USER-DEFINED NOT NULL DEFAULT 'STANDARD'::storage.buckettype,
    CONSTRAINT buckets_pkey PRIMARY KEY (id)
);
COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';

-- Table: storage.buckets_analytics
CREATE TABLE IF NOT EXISTS storage.buckets_analytics (
    name text NOT NULL,
    type USER-DEFINED NOT NULL DEFAULT 'ANALYTICS'::storage.buckettype,
    format text NOT NULL DEFAULT 'ICEBERG'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    deleted_at timestamp with time zone,
    CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id)
);

-- Table: storage.buckets_vectors
CREATE TABLE IF NOT EXISTS storage.buckets_vectors (
    id text NOT NULL,
    type USER-DEFINED NOT NULL DEFAULT 'VECTOR'::storage.buckettype,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: storage.migrations
CREATE TABLE IF NOT EXISTS storage.migrations (
    id integer(32) NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: storage.objects
CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens ARRAY,
    version text,
    owner_id text,
    user_metadata jsonb,
    level integer(32),
    CONSTRAINT objects_bucketId_fkey FOREIGN KEY (bucket_id) REFERENCES None.None(None),
    CONSTRAINT objects_pkey PRIMARY KEY (id)
);
COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';

-- Table: storage.prefixes
CREATE TABLE IF NOT EXISTS storage.prefixes (
    bucket_id text NOT NULL,
    name text NOT NULL,
    level integer(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT prefixes_bucketId_fkey FOREIGN KEY (bucket_id) REFERENCES None.None(None),
    CONSTRAINT prefixes_pkey PRIMARY KEY (bucket_id),
    CONSTRAINT prefixes_pkey PRIMARY KEY (level),
    CONSTRAINT prefixes_pkey PRIMARY KEY (name)
);

-- Table: storage.s3_multipart_uploads
CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint(64) NOT NULL DEFAULT 0,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL,
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    user_metadata jsonb,
    CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES None.None(None),
    CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id)
);

-- Table: storage.s3_multipart_uploads_parts
CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads_parts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    upload_id text NOT NULL,
    size bigint(64) NOT NULL DEFAULT 0,
    part_number integer(32) NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL,
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES None.None(None),
    CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id),
    CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES None.None(None)
);

-- Table: storage.vector_indexes
CREATE TABLE IF NOT EXISTS storage.vector_indexes (
    id text NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer(32) NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: supabase_migrations.schema_migrations
-- Description: Auth: Manages updates to the auth system.
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements ARRAY,
    name text,
    CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);
COMMENT ON TABLE supabase_migrations.schema_migrations IS 'Auth: Manages updates to the auth system.';

-- Table: supabase_migrations.seed_files
CREATE TABLE IF NOT EXISTS supabase_migrations.seed_files (
    path text NOT NULL,
    hash text NOT NULL,
    CONSTRAINT seed_files_pkey PRIMARY KEY (path)
);

-- Table: vault.secrets
-- Description: Table with encrypted `secret` column for storing sensitive information on disk.
CREATE TABLE IF NOT EXISTS vault.secrets (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text,
    description text NOT NULL DEFAULT ''::text,
    secret text NOT NULL,
    key_id uuid,
    nonce bytea DEFAULT vault._crypto_aead_det_noncegen(),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT secrets_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE vault.secrets IS 'Table with encrypted `secret` column for storing sensitive information on disk.';


-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');

CREATE TYPE auth.code_challenge_method AS ENUM ('s256', 'plain');

CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');

CREATE TYPE auth.factor_type AS ENUM ('totp', 'webauthn', 'phone');

CREATE TYPE auth.oauth_authorization_status AS ENUM ('pending', 'approved', 'denied', 'expired');

CREATE TYPE auth.oauth_client_type AS ENUM ('public', 'confidential');

CREATE TYPE auth.oauth_registration_type AS ENUM ('dynamic', 'manual');

CREATE TYPE auth.oauth_response_type AS ENUM ('code');

CREATE TYPE auth.one_time_token_type AS ENUM ('confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token');

CREATE TYPE public.access_status_type AS ENUM ('pending', 'approved', 'blocked');

CREATE TYPE public.boq_item_type AS ENUM ('мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.');
COMMENT ON TYPE public.boq_item_type IS 'Тип позиции в BOQ: материалы (мат, суб-мат, мат-комп.) и работы (раб, суб-раб, раб-комп.)';

CREATE TYPE public.construction_scope_type AS ENUM ('генподряд', 'коробка', 'монолит');

CREATE TYPE public.currency_type AS ENUM ('RUB', 'USD', 'EUR', 'CNY');

CREATE TYPE public.delivery_price_type AS ENUM ('в цене', 'не в цене', 'суммой');

CREATE TYPE public.housing_class_type AS ENUM ('комфорт', 'бизнес', 'премиум', 'делюкс');

CREATE TYPE public.material_type AS ENUM ('основн.', 'вспомогат.');

CREATE TYPE public.task_status AS ENUM ('running', 'paused', 'completed');

CREATE TYPE public.user_role_type AS ENUM ('Руководитель', 'Администратор', 'Разработчик', 'Старший группы', 'Инженер');

CREATE TYPE public.work_mode AS ENUM ('office', 'remote');

CREATE TYPE public.work_status AS ENUM ('working', 'not_working');

CREATE TYPE realtime.action AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ERROR');

CREATE TYPE realtime.equality_op AS ENUM ('eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in');

CREATE TYPE storage.buckettype AS ENUM ('STANDARD', 'ANALYTICS', 'VECTOR');


-- ============================================
-- VIEWS
-- ============================================

-- View: extensions.pg_stat_statements
CREATE OR REPLACE VIEW extensions.pg_stat_statements AS
 SELECT userid,
    dbid,
    toplevel,
    queryid,
    query,
    plans,
    total_plan_time,
    min_plan_time,
    max_plan_time,
    mean_plan_time,
    stddev_plan_time,
    calls,
    total_exec_time,
    min_exec_time,
    max_exec_time,
    mean_exec_time,
    stddev_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    shared_blks_dirtied,
    shared_blks_written,
    local_blks_hit,
    local_blks_read,
    local_blks_dirtied,
    local_blks_written,
    temp_blks_read,
    temp_blks_written,
    shared_blk_read_time,
    shared_blk_write_time,
    local_blk_read_time,
    local_blk_write_time,
    temp_blk_read_time,
    temp_blk_write_time,
    wal_records,
    wal_fpi,
    wal_bytes,
    jit_functions,
    jit_generation_time,
    jit_inlining_count,
    jit_inlining_time,
    jit_optimization_count,
    jit_optimization_time,
    jit_emission_count,
    jit_emission_time,
    jit_deform_count,
    jit_deform_time,
    stats_since,
    minmax_stats_since
   FROM pg_stat_statements(true) pg_stat_statements(userid, dbid, toplevel, queryid, query, plans, total_plan_time, min_plan_time, max_plan_time, mean_plan_time, stddev_plan_time, calls, total_exec_time, min_exec_time, max_exec_time, mean_exec_time, stddev_exec_time, rows, shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written, local_blks_hit, local_blks_read, local_blks_dirtied, local_blks_written, temp_blks_read, temp_blks_written, shared_blk_read_time, shared_blk_write_time, local_blk_read_time, local_blk_write_time, temp_blk_read_time, temp_blk_write_time, wal_records, wal_fpi, wal_bytes, jit_functions, jit_generation_time, jit_inlining_count, jit_inlining_time, jit_optimization_count, jit_optimization_time, jit_emission_count, jit_emission_time, jit_deform_count, jit_deform_time, stats_since, minmax_stats_since);

-- View: extensions.pg_stat_statements_info
CREATE OR REPLACE VIEW extensions.pg_stat_statements_info AS
 SELECT dealloc,
    stats_reset
   FROM pg_stat_statements_info() pg_stat_statements_info(dealloc, stats_reset);

-- View: public.materials_library_full_view
CREATE OR REPLACE VIEW public.materials_library_full_view AS
 SELECT m.id,
    m.material_type,
    m.item_type,
    mn.name AS material_name,
    mn.unit,
    m.consumption_coefficient,
    m.unit_rate,
    m.currency_type,
    m.delivery_price_type,
    m.delivery_amount,
    m.created_at,
    m.updated_at
   FROM (materials_library m
     JOIN material_names mn ON ((m.material_name_id = mn.id)));

-- View: public.works_library_full_view
CREATE OR REPLACE VIEW public.works_library_full_view AS
 SELECT w.id,
    w.item_type,
    wn.name AS work_name,
    wn.unit,
    w.unit_rate,
    w.currency_type,
    w.created_at,
    w.updated_at
   FROM (works_library w
     JOIN work_names wn ON ((w.work_name_id = wn.id)));

-- View: vault.decrypted_secrets
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
 SELECT id,
    name,
    description,
    secret,
    convert_from(vault._crypto_aead_det_decrypt(message => decode(secret, 'base64'::text), additional => convert_to((id)::text, 'utf8'::name), key_id => (0)::bigint, context => '\x7067736f6469756d'::bytea, nonce => nonce), 'utf8'::name) AS decrypted_secret,
    key_id,
    nonce,
    created_at,
    updated_at
   FROM vault.secrets s;


-- ============================================
-- FUNCTIONS
-- ============================================

-- Function: auth.email
-- Description: Deprecated. Use auth.jwt() -> 'email' instead.
CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$


-- Function: auth.jwt
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$


-- Function: auth.role
-- Description: Deprecated. Use auth.jwt() -> 'role' instead.
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$


-- Function: auth.uid
-- Description: Deprecated. Use auth.jwt() -> 'sub' instead.
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$


-- Function: extensions.armor
CREATE OR REPLACE FUNCTION extensions.armor(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$


-- Function: extensions.armor
CREATE OR REPLACE FUNCTION extensions.armor(bytea, text[], text[])
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$


-- Function: extensions.crypt
CREATE OR REPLACE FUNCTION extensions.crypt(text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_crypt$function$


-- Function: extensions.dearmor
CREATE OR REPLACE FUNCTION extensions.dearmor(text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_dearmor$function$


-- Function: extensions.decrypt
CREATE OR REPLACE FUNCTION extensions.decrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt$function$


-- Function: extensions.decrypt_iv
CREATE OR REPLACE FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt_iv$function$


-- Function: extensions.digest
CREATE OR REPLACE FUNCTION extensions.digest(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$


-- Function: extensions.digest
CREATE OR REPLACE FUNCTION extensions.digest(text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$


-- Function: extensions.encrypt
CREATE OR REPLACE FUNCTION extensions.encrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt$function$


-- Function: extensions.encrypt_iv
CREATE OR REPLACE FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt_iv$function$


-- Function: extensions.gen_random_bytes
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_random_bytes$function$


-- Function: extensions.gen_random_uuid
CREATE OR REPLACE FUNCTION extensions.gen_random_uuid()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/pgcrypto', $function$pg_random_uuid$function$


-- Function: extensions.gen_salt
CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt_rounds$function$


-- Function: extensions.gen_salt
CREATE OR REPLACE FUNCTION extensions.gen_salt(text)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt$function$


-- Function: extensions.grant_pg_cron_access
-- Description: Grants access to pg_cron
CREATE OR REPLACE FUNCTION extensions.grant_pg_cron_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$function$


-- Function: extensions.grant_pg_graphql_access
-- Description: Grants access to pg_graphql
CREATE OR REPLACE FUNCTION extensions.grant_pg_graphql_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$function$


-- Function: extensions.grant_pg_net_access
-- Description: Grants access to pg_net
CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$function$


-- Function: extensions.hmac
CREATE OR REPLACE FUNCTION extensions.hmac(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$


-- Function: extensions.hmac
CREATE OR REPLACE FUNCTION extensions.hmac(text, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$


-- Function: extensions.pg_stat_statements
CREATE OR REPLACE FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone)
 RETURNS SETOF record
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_1_11$function$


-- Function: extensions.pg_stat_statements_info
CREATE OR REPLACE FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone)
 RETURNS record
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_info$function$


-- Function: extensions.pg_stat_statements_reset
CREATE OR REPLACE FUNCTION extensions.pg_stat_statements_reset(userid oid DEFAULT 0, dbid oid DEFAULT 0, queryid bigint DEFAULT 0, minmax_only boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_reset_1_11$function$


-- Function: extensions.pgp_armor_headers
CREATE OR REPLACE FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_armor_headers$function$


-- Function: extensions.pgp_key_id
CREATE OR REPLACE FUNCTION extensions.pgp_key_id(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_key_id_w$function$


-- Function: extensions.pgp_pub_decrypt
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


-- Function: extensions.pgp_pub_decrypt
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


-- Function: extensions.pgp_pub_decrypt
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


-- Function: extensions.pgp_pub_decrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


-- Function: extensions.pgp_pub_decrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


-- Function: extensions.pgp_pub_decrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


-- Function: extensions.pgp_pub_encrypt
CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt(text, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$


-- Function: extensions.pgp_pub_encrypt
CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt(text, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$


-- Function: extensions.pgp_pub_encrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$


-- Function: extensions.pgp_pub_encrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$


-- Function: extensions.pgp_sym_decrypt
CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt(bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$


-- Function: extensions.pgp_sym_decrypt
CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt(bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$


-- Function: extensions.pgp_sym_decrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$


-- Function: extensions.pgp_sym_decrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$


-- Function: extensions.pgp_sym_encrypt
CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$


-- Function: extensions.pgp_sym_encrypt
CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$


-- Function: extensions.pgp_sym_encrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$


-- Function: extensions.pgp_sym_encrypt_bytea
CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$


-- Function: extensions.pgrst_ddl_watch
CREATE OR REPLACE FUNCTION extensions.pgrst_ddl_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$


-- Function: extensions.pgrst_drop_watch
CREATE OR REPLACE FUNCTION extensions.pgrst_drop_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$


-- Function: extensions.set_graphql_placeholder
-- Description: Reintroduces placeholder function for graphql_public.graphql
CREATE OR REPLACE FUNCTION extensions.set_graphql_placeholder()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$function$


-- Function: extensions.uuid_generate_v1
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$


-- Function: extensions.uuid_generate_v1mc
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$


-- Function: extensions.uuid_generate_v3
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$


-- Function: extensions.uuid_generate_v4
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$


-- Function: extensions.uuid_generate_v5
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$


-- Function: extensions.uuid_nil
CREATE OR REPLACE FUNCTION extensions.uuid_nil()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_nil$function$


-- Function: extensions.uuid_ns_dns
CREATE OR REPLACE FUNCTION extensions.uuid_ns_dns()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_dns$function$


-- Function: extensions.uuid_ns_oid
CREATE OR REPLACE FUNCTION extensions.uuid_ns_oid()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_oid$function$


-- Function: extensions.uuid_ns_url
CREATE OR REPLACE FUNCTION extensions.uuid_ns_url()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_url$function$


-- Function: extensions.uuid_ns_x500
CREATE OR REPLACE FUNCTION extensions.uuid_ns_x500()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_x500$function$


-- Function: graphql._internal_resolve
CREATE OR REPLACE FUNCTION graphql._internal_resolve(query text, variables jsonb DEFAULT '{}'::jsonb, "operationName" text DEFAULT NULL::text, extensions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE c
AS '$libdir/pg_graphql', $function$resolve_wrapper$function$


-- Function: graphql.comment_directive
CREATE OR REPLACE FUNCTION graphql.comment_directive(comment_ text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
    /*
    comment on column public.account.name is '@graphql.name: myField'
    */
    select
        coalesce(
            (
                regexp_match(
                    comment_,
                    '@graphql\((.+)\)'
                )
            )[1]::jsonb,
            jsonb_build_object()
        )
$function$


-- Function: graphql.exception
CREATE OR REPLACE FUNCTION graphql.exception(message text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
begin
    raise exception using errcode='22000', message=message;
end;
$function$


-- Function: graphql.get_schema_version
CREATE OR REPLACE FUNCTION graphql.get_schema_version()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    select last_value from graphql.seq_schema_version;
$function$


-- Function: graphql.increment_schema_version
CREATE OR REPLACE FUNCTION graphql.increment_schema_version()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
    perform pg_catalog.nextval('graphql.seq_schema_version');
end;
$function$


-- Function: graphql.resolve
CREATE OR REPLACE FUNCTION graphql.resolve(query text, variables jsonb DEFAULT '{}'::jsonb, "operationName" text DEFAULT NULL::text, extensions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
    res jsonb;
    message_text text;
begin
  begin
    select graphql._internal_resolve("query" := "query",
                                     "variables" := "variables",
                                     "operationName" := "operationName",
                                     "extensions" := "extensions") into res;
    return res;
  exception
    when others then
    get stacked diagnostics message_text = message_text;
    return
    jsonb_build_object('data', null,
                       'errors', jsonb_build_array(jsonb_build_object('message', message_text)));
  end;
end;
$function$


-- Function: graphql_public.graphql
CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
AS $function$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $function$


-- Function: pgbouncer.get_auth
CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename text)
 RETURNS TABLE(username text, password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $function$


-- Function: public.add_subcontract_growth_exclusion
-- Description: Добавляет исключение роста субподряда (или обновляет существующее)
CREATE OR REPLACE FUNCTION public.add_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

DECLARE

  v_id uuid;

BEGIN

  -- Проверяем валидность типа

  IF p_exclusion_type NOT IN ('works', 'materials') THEN

    RAISE EXCEPTION 'Invalid exclusion_type: must be ''works'' or ''materials''';

  END IF;



  -- Вставляем запись (или возвращаем существующую)

  INSERT INTO public.subcontract_growth_exclusions (

    tender_id,

    detail_cost_category_id,

    exclusion_type

  )

  VALUES (

    p_tender_id,

    p_detail_cost_category_id,

    p_exclusion_type

  )

  ON CONFLICT (tender_id, detail_cost_category_id, exclusion_type)

  DO UPDATE SET updated_at = now()

  RETURNING id INTO v_id;



  RETURN v_id;

END;

$function$


-- Function: public.check_user_page_access
-- Description: Check if user has access to a specific page URL. Returns TRUE if user can access the page.
CREATE OR REPLACE FUNCTION public.check_user_page_access(user_id uuid, page_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

  DECLARE

    user_record RECORD;

    allowed_page TEXT;

    pattern TEXT;

  BEGIN

    SELECT role, access_status, allowed_pages

    INTO user_record

    FROM public.users

    WHERE id = user_id;



    IF NOT FOUND OR user_record.access_status != 'approved' THEN

      RETURN FALSE;

    END IF;



    IF user_record.role IN ('Администратор', 'Руководитель', 'Разработчик') THEN     

      RETURN TRUE;

    END IF;



    IF jsonb_array_length(user_record.allowed_pages) = 0 THEN

      RETURN TRUE;

    END IF;



    FOR allowed_page IN

      SELECT jsonb_array_elements_text(user_record.allowed_pages)

    LOOP

      pattern := '^' || regexp_replace(allowed_page, ':[^/]+', '[^/]+', 'g') ||      

  '$';



      IF page_url ~ pattern THEN

        RETURN TRUE;

      END IF;

    END LOOP;



    RETURN FALSE;

  END;

  $function$


-- Function: public.clear_audit_user
-- Description: Очищает application_name после завершения операции
CREATE OR REPLACE FUNCTION public.clear_audit_user()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

    BEGIN

      -- Очистить значение на уровне сессии

      PERFORM set_config('app.current_user_id', '', true);

    END;

    $function$


-- Function: public.current_user_role
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role_type
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  SELECT role FROM public.users WHERE id = auth.uid();

$function$


-- Function: public.current_user_status
CREATE OR REPLACE FUNCTION public.current_user_status()
 RETURNS access_status_type
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  SELECT access_status FROM public.users WHERE id = auth.uid();

$function$


-- Function: public.delete_boq_item_with_audit
CREATE OR REPLACE FUNCTION public.delete_boq_item_with_audit(p_user_id uuid, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

  DECLARE

    v_old_item record;

  BEGIN

    -- Получаем старое состояние

    SELECT * INTO v_old_item FROM public.boq_items WHERE id = p_item_id;



    IF NOT FOUND THEN

      RAISE EXCEPTION 'BOQ item not found: %', p_item_id;

    END IF;



    -- Вручную вставляем audit запись ПЕРЕД удалением

    INSERT INTO public.boq_items_audit (

      boq_item_id,

      operation_type,

      changed_by,

      old_data

    ) VALUES (

      p_item_id,

      'DELETE',

      p_user_id,

      to_jsonb(v_old_item)

    );



    -- Выполняем DELETE

    DELETE FROM public.boq_items WHERE id = p_item_id;



    RETURN to_jsonb(v_old_item);

  END;

  $function$


-- Function: public.get_subcontract_growth_exclusions
-- Description: Получает список исключений роста субподряда для указанного тендера
CREATE OR REPLACE FUNCTION public.get_subcontract_growth_exclusions(p_tender_id uuid)
 RETURNS TABLE(detail_cost_category_id uuid, exclusion_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

BEGIN

  RETURN QUERY

  SELECT

    e.detail_cost_category_id,

    e.exclusion_type

  FROM public.subcontract_growth_exclusions e

  WHERE e.tender_id = p_tender_id;

END;

$function$


-- Function: public.handle_updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$function$


-- Function: public.insert_boq_item_with_audit
CREATE OR REPLACE FUNCTION public.insert_boq_item_with_audit(p_user_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

  DECLARE

    v_new_item record;

  BEGIN

    -- Выполняем INSERT

    INSERT INTO public.boq_items (

      tender_id,

      client_position_id,

      sort_number,

      boq_item_type,

      work_name_id,

      material_name_id,

      parent_work_item_id,

      unit_code,

      quantity,

      conversion_coefficient,

      consumption_coefficient,

      unit_rate,

      currency_type,

      total_amount,

      delivery_price_type,

      delivery_amount,

      quote_link,

      detail_cost_category_id,

      material_type

    )

    SELECT

      (p_data->>'tender_id')::uuid,

      (p_data->>'client_position_id')::uuid,

      COALESCE((p_data->>'sort_number')::integer, 0),

      (p_data->>'boq_item_type')::boq_item_type,

      (p_data->>'work_name_id')::uuid,

      (p_data->>'material_name_id')::uuid,

      (p_data->>'parent_work_item_id')::uuid,

      p_data->>'unit_code',

      COALESCE((p_data->>'quantity')::numeric, 1),

      (p_data->>'conversion_coefficient')::numeric,

      (p_data->>'consumption_coefficient')::numeric,

      COALESCE((p_data->>'unit_rate')::numeric, 0),

      COALESCE((p_data->>'currency_type')::currency_type, 'RUB'::currency_type),

      COALESCE((p_data->>'total_amount')::numeric, 0),

      (p_data->>'delivery_price_type')::delivery_price_type,

      (p_data->>'delivery_amount')::numeric,

      p_data->>'quote_link',

      (p_data->>'detail_cost_category_id')::uuid,

      (p_data->>'material_type')::material_type

    RETURNING * INTO v_new_item;



    -- Вручную вставляем audit запись с user_id

    INSERT INTO public.boq_items_audit (

      boq_item_id,

      operation_type,

      changed_by,

      new_data

    ) VALUES (

      v_new_item.id,

      'INSERT',

      p_user_id,

      to_jsonb(v_new_item)

    );



    RETURN to_jsonb(v_new_item);

  END;

  $function$


-- Function: public.log_boq_items_changes
-- Description: Триггер-функция для логирования всех изменений в boq_items (использует auth.uid() из JWT)
CREATE OR REPLACE FUNCTION public.log_boq_items_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

  DECLARE

    v_user_id uuid;

    v_changed_fields text[];

    v_key text;

    v_old_val jsonb;

    v_new_val jsonb;

  BEGIN

    -- Получаем user_id напрямую из JWT через auth.uid()

    BEGIN

      v_user_id := auth.uid();

    EXCEPTION WHEN OTHERS THEN

      v_user_id := NULL;

    END;



    -- Вычисляем измененные поля для UPDATE

    IF TG_OP = 'UPDATE' THEN

      v_changed_fields := ARRAY[]::text[];



      FOR v_key IN

        SELECT jsonb_object_keys(to_jsonb(NEW.*))

      LOOP

        v_old_val := to_jsonb(OLD.*) -> v_key;

        v_new_val := to_jsonb(NEW.*) -> v_key;



        IF v_key NOT IN ('updated_at', 'created_at')

           AND (v_old_val IS DISTINCT FROM v_new_val) THEN

          v_changed_fields := array_append(v_changed_fields, v_key);

        END IF;

      END LOOP;



      IF array_length(v_changed_fields, 1) IS NULL THEN

        RETURN NEW;

      END IF;

    END IF;



    -- Вставка записи в audit

    INSERT INTO public.boq_items_audit (

      boq_item_id,

      operation_type,

      changed_by,

      old_data,

      new_data,

      changed_fields

    ) VALUES (

      COALESCE(NEW.id, OLD.id),

      TG_OP,

      v_user_id,

      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD.*) ELSE NULL END,

      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW.*) ELSE NULL END,

      v_changed_fields

    );



    RETURN COALESCE(NEW, OLD);

  END;

  $function$


-- Function: public.register_user
CREATE OR REPLACE FUNCTION public.register_user(p_user_id uuid, p_full_name text, p_email text, p_role_code text, p_allowed_pages jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  DECLARE

    v_is_first_user BOOLEAN;

    v_access_status access_status_type;

  BEGIN

    -- Проверка первого пользователя

    SELECT NOT EXISTS (SELECT 1 FROM public.users LIMIT 1) INTO v_is_first_user;



    -- Первый admin/director/developer → auto-approved

    IF v_is_first_user AND p_role_code IN ('administrator', 'director', 'developer') THEN

      v_access_status := 'approved';



      INSERT INTO public.users (

        id, full_name, email, role_code, access_status, allowed_pages,

        approved_by, approved_at

      ) VALUES (

        p_user_id, p_full_name, p_email, p_role_code, v_access_status, p_allowed_pages,

        p_user_id, NOW()

      );

    ELSE

      -- Остальные → pending (ждут одобрения)

      v_access_status := 'pending';



      INSERT INTO public.users (

        id, full_name, email, role_code, access_status, allowed_pages

      ) VALUES (

        p_user_id, p_full_name, p_email, p_role_code, v_access_status, p_allowed_pages

      );

    END IF;

  END;

$function$


-- Function: public.remove_subcontract_growth_exclusion
-- Description: Удаляет исключение роста субподряда
CREATE OR REPLACE FUNCTION public.remove_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

DECLARE

  v_deleted boolean;

BEGIN

  DELETE FROM public.subcontract_growth_exclusions

  WHERE tender_id = p_tender_id

    AND detail_cost_category_id = p_detail_cost_category_id

    AND exclusion_type = p_exclusion_type;



  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;

END;

$function$


-- Function: public.set_audit_user
-- Description: Устанавливает user_id в application_name для триггера audit
CREATE OR REPLACE FUNCTION public.set_audit_user(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

    BEGIN

      -- Используем is_local = true для установки на уровне сессии

      PERFORM set_config('app.current_user_id', user_id::text, true);

    END;

    $function$


-- Function: public.set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$function$


-- Function: public.toggle_subcontract_growth_exclusion
-- Description: Переключает состояние исключения роста субподряда (вкл/выкл)
CREATE OR REPLACE FUNCTION public.toggle_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

DECLARE

  v_exists boolean;

BEGIN

  -- Проверяем существование

  SELECT EXISTS (

    SELECT 1

    FROM public.subcontract_growth_exclusions

    WHERE tender_id = p_tender_id

      AND detail_cost_category_id = p_detail_cost_category_id

      AND exclusion_type = p_exclusion_type

  ) INTO v_exists;



  IF v_exists THEN

    -- Удаляем если существует

    PERFORM remove_subcontract_growth_exclusion(p_tender_id, p_detail_cost_category_id, p_exclusion_type);

    RETURN false;

  ELSE

    -- Добавляем если не существует

    PERFORM add_subcontract_growth_exclusion(p_tender_id, p_detail_cost_category_id, p_exclusion_type);

    RETURN true;

  END IF;

END;

$function$


-- Function: public.update_boq_item_with_audit
CREATE OR REPLACE FUNCTION public.update_boq_item_with_audit(p_user_id uuid, p_item_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

    DECLARE

      v_old_item record;

      v_new_item record;

      v_changed_fields text[] := ARRAY[]::text[];

      v_key text;

      v_old_val jsonb;

      v_new_val jsonb;

    BEGIN

      -- Получаем старое состояние

      SELECT * INTO v_old_item FROM public.boq_items WHERE id = p_item_id;



      IF NOT FOUND THEN

        RAISE EXCEPTION 'BOQ item not found: %', p_item_id;

      END IF;



      -- Выполняем UPDATE только переданных полей

      UPDATE public.boq_items

      SET

        boq_item_type = COALESCE((p_data->>'boq_item_type')::boq_item_type, boq_item_type),

        quantity = COALESCE((p_data->>'quantity')::numeric, quantity),

        unit_rate = COALESCE((p_data->>'unit_rate')::numeric, unit_rate),

        total_amount = COALESCE((p_data->>'total_amount')::numeric, total_amount),

        conversion_coefficient = COALESCE((p_data->>'conversion_coefficient')::numeric, conversion_coefficient),      

        consumption_coefficient = COALESCE((p_data->>'consumption_coefficient')::numeric, consumption_coefficient),   

        delivery_price_type = COALESCE((p_data->>'delivery_price_type')::delivery_price_type, delivery_price_type),   

        delivery_amount = COALESCE((p_data->>'delivery_amount')::numeric, delivery_amount),

        currency_type = COALESCE((p_data->>'currency_type')::currency_type, currency_type),

        quote_link = COALESCE(p_data->>'quote_link', quote_link),

        description = COALESCE(p_data->>'description', description),

        detail_cost_category_id = COALESCE((p_data->>'detail_cost_category_id')::uuid, detail_cost_category_id),      

        material_type = COALESCE((p_data->>'material_type')::material_type, material_type),

        work_name_id = COALESCE((p_data->>'work_name_id')::uuid, work_name_id),

        material_name_id = COALESCE((p_data->>'material_name_id')::uuid, material_name_id),

        unit_code = COALESCE(p_data->>'unit_code', unit_code),

        parent_work_item_id = COALESCE((p_data->>'parent_work_item_id')::uuid, parent_work_item_id),

        sort_number = COALESCE((p_data->>'sort_number')::integer, sort_number)

      WHERE id = p_item_id

      RETURNING * INTO v_new_item;



      -- Сравниваем old и new, добавляем только реально измененные поля

      FOR v_key IN SELECT jsonb_object_keys(to_jsonb(v_new_item.*))

      LOOP

        v_old_val := to_jsonb(v_old_item.*) -> v_key;

        v_new_val := to_jsonb(v_new_item.*) -> v_key;



        -- Пропускаем служебные поля

        IF v_key NOT IN ('updated_at', 'created_at', 'id') THEN

          -- Добавляем в список только если значение изменилось

          IF v_old_val IS DISTINCT FROM v_new_val THEN

            v_changed_fields := array_append(v_changed_fields, v_key);

          END IF;

        END IF;

      END LOOP;



      -- Если ничего не изменилось, не создаем audit запись

      IF array_length(v_changed_fields, 1) IS NULL THEN

        RETURN to_jsonb(v_new_item);

      END IF;



      -- Вручную вставляем audit запись с user_id

      INSERT INTO public.boq_items_audit (

        boq_item_id,

        operation_type,

        changed_by,

        old_data,

        new_data,

        changed_fields

      ) VALUES (

        p_item_id,

        'UPDATE',

        p_user_id,

        to_jsonb(v_old_item),

        to_jsonb(v_new_item),

        v_changed_fields

      );



      RETURN to_jsonb(v_new_item);

    END;

    $function$


-- Function: public.update_boq_items_updated_at
CREATE OR REPLACE FUNCTION public.update_boq_items_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

    NEW.updated_at = now();

    RETURN NEW;

END;

$function$


-- Function: public.update_client_positions_updated_at
CREATE OR REPLACE FUNCTION public.update_client_positions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$function$


-- Function: public.update_cost_redistribution_results_updated_at
CREATE OR REPLACE FUNCTION public.update_cost_redistribution_results_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$function$


-- Function: public.update_markup_parameters_updated_at
CREATE OR REPLACE FUNCTION public.update_markup_parameters_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$function$


-- Function: public.update_markup_tactics_updated_at
CREATE OR REPLACE FUNCTION public.update_markup_tactics_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$function$


-- Function: public.update_roles_updated_at
CREATE OR REPLACE FUNCTION public.update_roles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$function$


-- Function: public.update_tender_documents_updated_at
CREATE OR REPLACE FUNCTION public.update_tender_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$function$


-- Function: public.update_tender_markup_percentage_updated_at
CREATE OR REPLACE FUNCTION public.update_tender_markup_percentage_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$function$


-- Function: public.update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$


-- Function: realtime.apply_rls
CREATE OR REPLACE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024))
 RETURNS SETOF realtime.wal_rls
 LANGUAGE plpgsql
AS $function$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_;

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$function$


-- Function: realtime.broadcast_changes
CREATE OR REPLACE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$function$


-- Function: realtime.build_prepared_statement_sql
CREATE OR REPLACE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[])
 RETURNS text
 LANGUAGE sql
AS $function$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $function$


-- Function: realtime.cast
CREATE OR REPLACE FUNCTION realtime."cast"(val text, type_ regtype)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
    declare
      res jsonb;
    begin
      execute format('select to_jsonb(%L::'|| type_::text || ')', val)  into res;
      return res;
    end
    $function$


-- Function: realtime.check_equality_op
CREATE OR REPLACE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $function$


-- Function: realtime.is_visible_through_filters
CREATE OR REPLACE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $function$


-- Function: realtime.list_changes
CREATE OR REPLACE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer)
 RETURNS SETOF realtime.wal_rls
 LANGUAGE sql
 SET log_min_messages TO 'fatal'
AS $function$
      with pub as (
        select
          concat_ws(
            ',',
            case when bool_or(pubinsert) then 'insert' else null end,
            case when bool_or(pubupdate) then 'update' else null end,
            case when bool_or(pubdelete) then 'delete' else null end
          ) as w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
            ''
          ) w2j_add_tables
        from
          pg_publication pp
          left join pg_publication_tables ppt
            on pp.pubname = ppt.pubname
        where
          pp.pubname = publication
        group by
          pp.pubname
        limit 1
      ),
      w2j as (
        select
          x.*, pub.w2j_add_tables
        from
          pub,
          pg_logical_slot_get_changes(
            slot_name, null, max_changes,
            'include-pk', 'true',
            'include-transaction', 'false',
            'include-timestamp', 'true',
            'include-type-oids', 'true',
            'format-version', '2',
            'actions', pub.w2j_actions,
            'add-tables', pub.w2j_add_tables
          ) x
      )
      select
        xyz.wal,
        xyz.is_rls_enabled,
        xyz.subscription_ids,
        xyz.errors
      from
        w2j,
        realtime.apply_rls(
          wal := w2j.data::jsonb,
          max_record_bytes := max_record_bytes
        ) xyz(wal, is_rls_enabled, subscription_ids, errors)
      where
        w2j.w2j_add_tables <> ''
        and xyz.subscription_ids[1] is not null
    $function$


-- Function: realtime.quote_wal2json
CREATE OR REPLACE FUNCTION realtime.quote_wal2json(entity regclass)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $function$


-- Function: realtime.send
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$function$


-- Function: realtime.subscription_check_filters
CREATE OR REPLACE FUNCTION realtime.subscription_check_filters()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $function$


-- Function: realtime.to_regrole
CREATE OR REPLACE FUNCTION realtime.to_regrole(role_name text)
 RETURNS regrole
 LANGUAGE sql
 IMMUTABLE
AS $function$ select role_name::regrole $function$


-- Function: realtime.topic
CREATE OR REPLACE FUNCTION realtime.topic()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
select nullif(current_setting('realtime.topic', true), '')::text;
$function$


-- Function: storage.add_prefixes
CREATE OR REPLACE FUNCTION storage.add_prefixes(_bucket_id text, _name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$function$


-- Function: storage.can_insert_object
CREATE OR REPLACE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$function$


-- Function: storage.delete_leaf_prefixes
CREATE OR REPLACE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$function$


-- Function: storage.delete_prefix
CREATE OR REPLACE FUNCTION storage.delete_prefix(_bucket_id text, _name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Check if we can delete the prefix
    IF EXISTS(
        SELECT FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name") + 1
          AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    )
    OR EXISTS(
        SELECT FROM "storage"."objects"
        WHERE "objects"."bucket_id" = "_bucket_id"
          AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
          AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    ) THEN
    -- There are sub-objects, skip deletion
    RETURN false;
    ELSE
        DELETE FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name")
          AND "prefixes"."name" = "_name";
        RETURN true;
    END IF;
END;
$function$


-- Function: storage.delete_prefix_hierarchy_trigger
CREATE OR REPLACE FUNCTION storage.delete_prefix_hierarchy_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$function$


-- Function: storage.enforce_bucket_name_length
CREATE OR REPLACE FUNCTION storage.enforce_bucket_name_length()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$


-- Function: storage.extension
CREATE OR REPLACE FUNCTION storage.extension(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$function$


-- Function: storage.filename
CREATE OR REPLACE FUNCTION storage.filename(name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$function$


-- Function: storage.foldername
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$


-- Function: storage.get_level
CREATE OR REPLACE FUNCTION storage.get_level(name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
SELECT array_length(string_to_array("name", '/'), 1);
$function$


-- Function: storage.get_prefix
CREATE OR REPLACE FUNCTION storage.get_prefix(name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$function$


-- Function: storage.get_prefixes
CREATE OR REPLACE FUNCTION storage.get_prefixes(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$function$


-- Function: storage.get_size_by_bucket
CREATE OR REPLACE FUNCTION storage.get_size_by_bucket()
 RETURNS TABLE(size bigint, bucket_id text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$function$


-- Function: storage.list_multipart_uploads_with_delimiter
CREATE OR REPLACE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text)
 RETURNS TABLE(key text, id text, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$function$


-- Function: storage.list_objects_with_delimiter
CREATE OR REPLACE FUNCTION storage.list_objects_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text)
 RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(name COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                        substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
                    ELSE
                        name
                END AS name, id, metadata, updated_at
            FROM
                storage.objects
            WHERE
                bucket_id = $5 AND
                name ILIKE $1 || ''%'' AND
                CASE
                    WHEN $6 != '''' THEN
                    name COLLATE "C" > $6
                ELSE true END
                AND CASE
                    WHEN $4 != '''' THEN
                        CASE
                            WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                                substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                name COLLATE "C" > $4
                            END
                    ELSE
                        true
                END
            ORDER BY
                name COLLATE "C" ASC) as e order by name COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
END;
$function$


-- Function: storage.lock_top_prefixes
CREATE OR REPLACE FUNCTION storage.lock_top_prefixes(bucket_ids text[], names text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_bucket text;
    v_top text;
BEGIN
    FOR v_bucket, v_top IN
        SELECT DISTINCT t.bucket_id,
            split_part(t.name, '/', 1) AS top
        FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        WHERE t.name <> ''
        ORDER BY 1, 2
        LOOP
            PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket || '/' || v_top, 0));
        END LOOP;
END;
$function$


-- Function: storage.objects_delete_cleanup
CREATE OR REPLACE FUNCTION storage.objects_delete_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$function$


-- Function: storage.objects_insert_prefix_trigger
CREATE OR REPLACE FUNCTION storage.objects_insert_prefix_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$function$


-- Function: storage.objects_update_cleanup
CREATE OR REPLACE FUNCTION storage.objects_update_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    -- NEW - OLD (destinations to create prefixes for)
    v_add_bucket_ids text[];
    v_add_names      text[];

    -- OLD - NEW (sources to prune)
    v_src_bucket_ids text[];
    v_src_names      text[];
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NULL;
    END IF;

    -- 1) Compute NEW−OLD (added paths) and OLD−NEW (moved-away paths)
    WITH added AS (
        SELECT n.bucket_id, n.name
        FROM new_rows n
        WHERE n.name <> '' AND position('/' in n.name) > 0
        EXCEPT
        SELECT o.bucket_id, o.name FROM old_rows o WHERE o.name <> ''
    ),
    moved AS (
         SELECT o.bucket_id, o.name
         FROM old_rows o
         WHERE o.name <> ''
         EXCEPT
         SELECT n.bucket_id, n.name FROM new_rows n WHERE n.name <> ''
    )
    SELECT
        -- arrays for ADDED (dest) in stable order
        COALESCE( (SELECT array_agg(a.bucket_id ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        COALESCE( (SELECT array_agg(a.name      ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        -- arrays for MOVED (src) in stable order
        COALESCE( (SELECT array_agg(m.bucket_id ORDER BY m.bucket_id, m.name) FROM moved m), '{}' ),
        COALESCE( (SELECT array_agg(m.name      ORDER BY m.bucket_id, m.name) FROM moved m), '{}' )
    INTO v_add_bucket_ids, v_add_names, v_src_bucket_ids, v_src_names;

    -- Nothing to do?
    IF (array_length(v_add_bucket_ids, 1) IS NULL) AND (array_length(v_src_bucket_ids, 1) IS NULL) THEN
        RETURN NULL;
    END IF;

    -- 2) Take per-(bucket, top) locks: ALL prefixes in consistent global order to prevent deadlocks
    DECLARE
        v_all_bucket_ids text[];
        v_all_names text[];
    BEGIN
        -- Combine source and destination arrays for consistent lock ordering
        v_all_bucket_ids := COALESCE(v_src_bucket_ids, '{}') || COALESCE(v_add_bucket_ids, '{}');
        v_all_names := COALESCE(v_src_names, '{}') || COALESCE(v_add_names, '{}');

        -- Single lock call ensures consistent global ordering across all transactions
        IF array_length(v_all_bucket_ids, 1) IS NOT NULL THEN
            PERFORM storage.lock_top_prefixes(v_all_bucket_ids, v_all_names);
        END IF;
    END;

    -- 3) Create destination prefixes (NEW−OLD) BEFORE pruning sources
    IF array_length(v_add_bucket_ids, 1) IS NOT NULL THEN
        WITH candidates AS (
            SELECT DISTINCT t.bucket_id, unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(v_add_bucket_ids, v_add_names) AS t(bucket_id, name)
            WHERE name <> ''
        )
        INSERT INTO storage.prefixes (bucket_id, name)
        SELECT c.bucket_id, c.name
        FROM candidates c
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4) Prune source prefixes bottom-up for OLD−NEW
    IF array_length(v_src_bucket_ids, 1) IS NOT NULL THEN
        -- re-entrancy guard so DELETE on prefixes won't recurse
        IF current_setting('storage.gc.prefixes', true) <> '1' THEN
            PERFORM set_config('storage.gc.prefixes', '1', true);
        END IF;

        PERFORM storage.delete_leaf_prefixes(v_src_bucket_ids, v_src_names);
    END IF;

    RETURN NULL;
END;
$function$


-- Function: storage.objects_update_level_trigger
CREATE OR REPLACE FUNCTION storage.objects_update_level_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Set the new level
        NEW."level" := "storage"."get_level"(NEW."name");
    END IF;
    RETURN NEW;
END;
$function$


-- Function: storage.objects_update_prefix_trigger
CREATE OR REPLACE FUNCTION storage.objects_update_prefix_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    old_prefixes TEXT[];
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Retrieve old prefixes
        old_prefixes := "storage"."get_prefixes"(OLD."name");

        -- Remove old prefixes that are only used by this object
        WITH all_prefixes as (
            SELECT unnest(old_prefixes) as prefix
        ),
        can_delete_prefixes as (
             SELECT prefix
             FROM all_prefixes
             WHERE NOT EXISTS (
                 SELECT 1 FROM "storage"."objects"
                 WHERE "bucket_id" = OLD."bucket_id"
                   AND "name" <> OLD."name"
                   AND "name" LIKE (prefix || '%')
             )
         )
        DELETE FROM "storage"."prefixes" WHERE name IN (SELECT prefix FROM can_delete_prefixes);

        -- Add new prefixes
        PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    END IF;
    -- Set the new level
    NEW."level" := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$function$


-- Function: storage.operation
CREATE OR REPLACE FUNCTION storage.operation()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$function$


-- Function: storage.prefixes_delete_cleanup
CREATE OR REPLACE FUNCTION storage.prefixes_delete_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$function$


-- Function: storage.prefixes_insert_trigger
CREATE OR REPLACE FUNCTION storage.prefixes_insert_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$function$


-- Function: storage.search
CREATE OR REPLACE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text)
 RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
AS $function$
declare
    can_bypass_rls BOOLEAN;
begin
    SELECT rolbypassrls
    INTO can_bypass_rls
    FROM pg_roles
    WHERE rolname = coalesce(nullif(current_setting('role', true), 'none'), current_user);

    IF can_bypass_rls THEN
        RETURN QUERY SELECT * FROM storage.search_v1_optimised(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    ELSE
        RETURN QUERY SELECT * FROM storage.search_legacy_v1(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    END IF;
end;
$function$


-- Function: storage.search_legacy_v1
CREATE OR REPLACE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text)
 RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$function$


-- Function: storage.search_v1_optimised
CREATE OR REPLACE FUNCTION storage.search_v1_optimised(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text)
 RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select (string_to_array(name, ''/''))[level] as name
           from storage.prefixes
             where lower(prefixes.name) like lower($2 || $3) || ''%''
               and bucket_id = $4
               and level = $1
           order by name ' || v_sort_order || '
     )
     (select name,
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[level] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where lower(objects.name) like lower($2 || $3) || ''%''
       and bucket_id = $4
       and level = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$function$


-- Function: storage.search_v2
CREATE OR REPLACE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text)
 RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    sort_col text;
    sort_ord text;
    cursor_op text;
    cursor_expr text;
    sort_expr text;
BEGIN
    -- Validate sort_order
    sort_ord := lower(sort_order);
    IF sort_ord NOT IN ('asc', 'desc') THEN
        sort_ord := 'asc';
    END IF;

    -- Determine cursor comparison operator
    IF sort_ord = 'asc' THEN
        cursor_op := '>';
    ELSE
        cursor_op := '<';
    END IF;
    
    sort_col := lower(sort_column);
    -- Validate sort column  
    IF sort_col IN ('updated_at', 'created_at') THEN
        cursor_expr := format(
            '($5 = '''' OR ROW(date_trunc(''milliseconds'', %I), name COLLATE "C") %s ROW(COALESCE(NULLIF($6, '''')::timestamptz, ''epoch''::timestamptz), $5))',
            sort_col, cursor_op
        );
        sort_expr := format(
            'COALESCE(date_trunc(''milliseconds'', %I), ''epoch''::timestamptz) %s, name COLLATE "C" %s',
            sort_col, sort_ord, sort_ord
        );
    ELSE
        cursor_expr := format('($5 = '''' OR name COLLATE "C" %s $5)', cursor_op);
        sort_expr := format('name COLLATE "C" %s', sort_ord);
    END IF;

    RETURN QUERY EXECUTE format(
        $sql$
        SELECT * FROM (
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    NULL::uuid AS id,
                    updated_at,
                    created_at,
                    NULL::timestamptz AS last_accessed_at,
                    NULL::jsonb AS metadata
                FROM storage.prefixes
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
            UNION ALL
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    id,
                    updated_at,
                    created_at,
                    last_accessed_at,
                    metadata
                FROM storage.objects
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
        ) obj
        ORDER BY %s
        LIMIT $3
        $sql$,
        cursor_expr,    -- prefixes WHERE
        sort_expr,      -- prefixes ORDER BY
        cursor_expr,    -- objects WHERE
        sort_expr,      -- objects ORDER BY
        sort_expr       -- final ORDER BY
    )
    USING prefix, bucket_name, limits, levels, start_after, sort_column_after;
END;
$function$


-- Function: storage.update_updated_at_column
CREATE OR REPLACE FUNCTION storage.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$function$


-- Function: vault._crypto_aead_det_decrypt
CREATE OR REPLACE FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea DEFAULT '\x7067736f6469756d'::bytea, nonce bytea DEFAULT NULL::bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_decrypt_by_id$function$


-- Function: vault._crypto_aead_det_encrypt
CREATE OR REPLACE FUNCTION vault._crypto_aead_det_encrypt(message bytea, additional bytea, key_id bigint, context bytea DEFAULT '\x7067736f6469756d'::bytea, nonce bytea DEFAULT NULL::bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_encrypt_by_id$function$


-- Function: vault._crypto_aead_det_noncegen
CREATE OR REPLACE FUNCTION vault._crypto_aead_det_noncegen()
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_noncegen$function$


-- Function: vault.create_secret
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL::text, new_description text DEFAULT ''::text, new_key_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  rec record;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (
    new_secret,
    new_name,
    new_description
  )
  RETURNING * INTO rec;
  UPDATE vault.secrets s
  SET secret = encode(vault._crypto_aead_det_encrypt(
    message := convert_to(rec.secret, 'utf8'),
    additional := convert_to(s.id::text, 'utf8'),
    key_id := 0,
    context := 'pgsodium'::bytea,
    nonce := rec.nonce
  ), 'base64')
  WHERE id = rec.id;
  RETURN rec.id;
END
$function$


-- Function: vault.update_secret
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL::text, new_name text DEFAULT NULL::text, new_description text DEFAULT NULL::text, new_key_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  decrypted_secret text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id);
BEGIN
  UPDATE vault.secrets s
  SET
    secret = CASE WHEN new_secret IS NULL THEN s.secret
                  ELSE encode(vault._crypto_aead_det_encrypt(
                    message := convert_to(new_secret, 'utf8'),
                    additional := convert_to(s.id::text, 'utf8'),
                    key_id := 0,
                    context := 'pgsodium'::bytea,
                    nonce := s.nonce
                  ), 'base64') END,
    name = coalesce(new_name, s.name),
    description = coalesce(new_description, s.description),
    updated_at = now()
  WHERE s.id = secret_id;
END
$function$



-- ============================================
-- TRIGGERS
-- ============================================

-- Trigger: boq_items_updated_at_trigger on public.boq_items
CREATE TRIGGER boq_items_updated_at_trigger BEFORE UPDATE ON public.boq_items FOR EACH ROW EXECUTE FUNCTION update_boq_items_updated_at()

-- Trigger: trg_boq_items_audit on public.boq_items (автоматический аудит через auth.uid())
CREATE TRIGGER trg_boq_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.boq_items FOR EACH ROW EXECUTE FUNCTION public.log_boq_items_changes()

-- Trigger: trigger_update_client_positions_updated_at on public.client_positions
CREATE TRIGGER trigger_update_client_positions_updated_at BEFORE UPDATE ON public.client_positions FOR EACH ROW EXECUTE FUNCTION update_client_positions_updated_at()

-- Trigger: update_construction_cost_volumes_updated_at on public.construction_cost_volumes
CREATE TRIGGER update_construction_cost_volumes_updated_at BEFORE UPDATE ON public.construction_cost_volumes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_cost_categories_updated_at on public.cost_categories
CREATE TRIGGER update_cost_categories_updated_at BEFORE UPDATE ON public.cost_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: trigger_update_cost_redistribution_results_updated_at on public.cost_redistribution_results
CREATE TRIGGER trigger_update_cost_redistribution_results_updated_at BEFORE UPDATE ON public.cost_redistribution_results FOR EACH ROW EXECUTE FUNCTION update_cost_redistribution_results_updated_at()

-- Trigger: update_detail_cost_categories_updated_at on public.detail_cost_categories
CREATE TRIGGER update_detail_cost_categories_updated_at BEFORE UPDATE ON public.detail_cost_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: trigger_update_markup_parameters_updated_at on public.markup_parameters
CREATE TRIGGER trigger_update_markup_parameters_updated_at BEFORE UPDATE ON public.markup_parameters FOR EACH ROW EXECUTE FUNCTION update_markup_parameters_updated_at()

-- Trigger: trigger_update_markup_tactics_updated_at on public.markup_tactics
CREATE TRIGGER trigger_update_markup_tactics_updated_at BEFORE UPDATE ON public.markup_tactics FOR EACH ROW EXECUTE FUNCTION update_markup_tactics_updated_at()

-- Trigger: update_material_names_updated_at on public.material_names
CREATE TRIGGER update_material_names_updated_at BEFORE UPDATE ON public.material_names FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_materials_library_updated_at on public.materials_library
CREATE TRIGGER update_materials_library_updated_at BEFORE UPDATE ON public.materials_library FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: roles_updated_at_trigger on public.roles
CREATE TRIGGER roles_updated_at_trigger BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION update_roles_updated_at()

-- Trigger: set_updated_at on public.subcontract_growth_exclusions
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subcontract_growth_exclusions FOR EACH ROW EXECUTE FUNCTION handle_updated_at()

-- Trigger: set_updated_at_template_items on public.template_items
CREATE TRIGGER set_updated_at_template_items BEFORE UPDATE ON public.template_items FOR EACH ROW EXECUTE FUNCTION set_updated_at()

-- Trigger: set_updated_at_templates on public.templates
CREATE TRIGGER set_updated_at_templates BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION set_updated_at()

-- Trigger: trigger_update_tender_documents_timestamp on public.tender_documents
-- Description: Автоматически обновляет поле updated_at при изменении записи
CREATE TRIGGER trigger_update_tender_documents_timestamp BEFORE UPDATE ON public.tender_documents FOR EACH ROW EXECUTE FUNCTION update_tender_documents_updated_at()

-- Trigger: trigger_update_tender_markup_percentage_updated_at on public.tender_markup_percentage
CREATE TRIGGER trigger_update_tender_markup_percentage_updated_at BEFORE UPDATE ON public.tender_markup_percentage FOR EACH ROW EXECUTE FUNCTION update_tender_markup_percentage_updated_at()

-- Trigger: set_updated_at_tender_pricing_distribution on public.tender_pricing_distribution
CREATE TRIGGER set_updated_at_tender_pricing_distribution BEFORE UPDATE ON public.tender_pricing_distribution FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_tenders_updated_at on public.tenders
CREATE TRIGGER update_tenders_updated_at BEFORE UPDATE ON public.tenders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_units_updated_at on public.units
CREATE TRIGGER update_units_updated_at BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: set_user_tasks_updated_at on public.user_tasks
CREATE TRIGGER set_user_tasks_updated_at BEFORE UPDATE ON public.user_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_users_updated_at on public.users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_work_names_updated_at on public.work_names
CREATE TRIGGER update_work_names_updated_at BEFORE UPDATE ON public.work_names FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: update_works_library_updated_at on public.works_library
CREATE TRIGGER update_works_library_updated_at BEFORE UPDATE ON public.works_library FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Trigger: tr_check_filters on realtime.subscription
CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters()

-- Trigger: enforce_bucket_name_length_trigger on storage.buckets
CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length()

-- Trigger: objects_delete_delete_prefix on storage.objects
CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger()

-- Trigger: objects_insert_create_prefix on storage.objects
CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger()

-- Trigger: objects_update_create_prefix on storage.objects
CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger()

-- Trigger: update_objects_updated_at on storage.objects
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column()

-- Trigger: prefixes_create_hierarchy on storage.prefixes
CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger()

-- Trigger: prefixes_delete_hierarchy on storage.prefixes
CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger()


-- ============================================
-- INDEXES
-- ============================================

-- Index on auth.audit_log_entries
CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);

-- Index on auth.flow_state
CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);

-- Index on auth.flow_state
CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);

-- Index on auth.flow_state
CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);

-- Index on auth.identities
CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);

-- Index on auth.identities
CREATE UNIQUE INDEX identities_provider_id_provider_unique ON auth.identities USING btree (provider_id, provider);

-- Index on auth.identities
CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);

-- Index on auth.mfa_amr_claims
CREATE UNIQUE INDEX amr_id_pk ON auth.mfa_amr_claims USING btree (id);

-- Index on auth.mfa_challenges
CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);

-- Index on auth.mfa_factors
CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);

-- Index on auth.mfa_factors
CREATE UNIQUE INDEX mfa_factors_last_challenged_at_key ON auth.mfa_factors USING btree (last_challenged_at);

-- Index on auth.mfa_factors
CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);

-- Index on auth.mfa_factors
CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);

-- Index on auth.mfa_factors
CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);

-- Index on auth.oauth_authorizations
CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);

-- Index on auth.oauth_authorizations
CREATE UNIQUE INDEX oauth_authorizations_authorization_code_key ON auth.oauth_authorizations USING btree (authorization_code);

-- Index on auth.oauth_authorizations
CREATE UNIQUE INDEX oauth_authorizations_authorization_id_key ON auth.oauth_authorizations USING btree (authorization_id);

-- Index on auth.oauth_client_states
CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);

-- Index on auth.oauth_clients
CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);

-- Index on auth.oauth_consents
CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);

-- Index on auth.oauth_consents
CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);

-- Index on auth.oauth_consents
CREATE UNIQUE INDEX oauth_consents_user_client_unique ON auth.oauth_consents USING btree (user_id, client_id);

-- Index on auth.oauth_consents
CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);

-- Index on auth.one_time_tokens
CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);

-- Index on auth.one_time_tokens
CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);

-- Index on auth.one_time_tokens
CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);

-- Index on auth.refresh_tokens
CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);

-- Index on auth.refresh_tokens
CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);

-- Index on auth.refresh_tokens
CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);

-- Index on auth.refresh_tokens
CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);

-- Index on auth.refresh_tokens
CREATE UNIQUE INDEX refresh_tokens_token_unique ON auth.refresh_tokens USING btree (token);

-- Index on auth.refresh_tokens
CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);

-- Index on auth.saml_providers
CREATE UNIQUE INDEX saml_providers_entity_id_key ON auth.saml_providers USING btree (entity_id);

-- Index on auth.saml_providers
CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);

-- Index on auth.saml_relay_states
CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);

-- Index on auth.saml_relay_states
CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);

-- Index on auth.saml_relay_states
CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);

-- Index on auth.sessions
CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);

-- Index on auth.sessions
CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);

-- Index on auth.sessions
CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);

-- Index on auth.sessions
CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);

-- Index on auth.sso_domains
CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));

-- Index on auth.sso_domains
CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);

-- Index on auth.sso_providers
CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));

-- Index on auth.sso_providers
CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);

-- Index on auth.users
CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);

-- Index on auth.users
CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);

-- Index on auth.users
CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);

-- Index on auth.users
CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);

-- Index on auth.users
CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);

-- Index on auth.users
CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);

-- Index on auth.users
CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));

-- Index on auth.users
CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);

-- Index on auth.users
CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);

-- Index on auth.users
CREATE UNIQUE INDEX users_phone_key ON auth.users USING btree (phone);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_boq_item_type ON public.boq_items USING btree (boq_item_type);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_client_position_id ON public.boq_items USING btree (client_position_id);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_detail_cost_category_id ON public.boq_items USING btree (detail_cost_category_id);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_material_name ON public.boq_items USING btree (material_name_id) WHERE (material_name_id IS NOT NULL);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_material_name_id ON public.boq_items USING btree (material_name_id);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_parent_work_item_id ON public.boq_items USING btree (parent_work_item_id);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_position_sort ON public.boq_items USING btree (client_position_id, sort_number);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_position_type ON public.boq_items USING btree (client_position_id, boq_item_type);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_sort_number ON public.boq_items USING btree (client_position_id, sort_number);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_tender_id ON public.boq_items USING btree (tender_id);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_work_name ON public.boq_items USING btree (work_name_id) WHERE (work_name_id IS NOT NULL);

-- Index on public.boq_items
CREATE INDEX idx_boq_items_work_name_id ON public.boq_items USING btree (work_name_id);

-- Index on public.boq_items_audit
CREATE INDEX idx_audit_changed_at ON public.boq_items_audit USING btree (changed_at DESC);

-- Index on public.boq_items_audit
CREATE INDEX idx_audit_changed_by ON public.boq_items_audit USING btree (changed_by);

-- Index on public.boq_items_audit
CREATE INDEX idx_audit_new_position ON public.boq_items_audit USING btree (((new_data ->> 'client_position_id'::text)));

-- Index on public.boq_items_audit
CREATE INDEX idx_audit_old_position ON public.boq_items_audit USING btree (((old_data ->> 'client_position_id'::text)));

-- Index on public.boq_items_audit
CREATE INDEX idx_boq_items_audit_changed_at ON public.boq_items_audit USING btree (changed_at DESC);

-- Index on public.boq_items_audit
CREATE INDEX idx_boq_items_audit_changed_by ON public.boq_items_audit USING btree (changed_by);

-- Index on public.boq_items_audit
CREATE INDEX idx_boq_items_audit_fields ON public.boq_items_audit USING gin (changed_fields);

-- Index on public.boq_items_audit
CREATE INDEX idx_boq_items_audit_item_id ON public.boq_items_audit USING btree (boq_item_id);

-- Index on public.boq_items_audit
CREATE INDEX idx_boq_items_audit_operation ON public.boq_items_audit USING btree (operation_type);

-- Index on public.client_positions
CREATE INDEX idx_client_positions_is_additional ON public.client_positions USING btree (tender_id, is_additional);

-- Index on public.client_positions
CREATE INDEX idx_client_positions_parent_id ON public.client_positions USING btree (parent_position_id);

-- Index on public.client_positions
CREATE INDEX idx_client_positions_position_number ON public.client_positions USING btree (tender_id, position_number);

-- Index on public.client_positions
CREATE INDEX idx_client_positions_tender_id ON public.client_positions USING btree (tender_id);

-- Index on public.client_positions
CREATE INDEX idx_client_positions_tender_num ON public.client_positions USING btree (tender_id, position_number);

-- Index on public.construction_cost_volumes
CREATE UNIQUE INDEX construction_cost_volumes_tender_detail_key ON public.construction_cost_volumes USING btree (tender_id, detail_cost_category_id) WHERE (detail_cost_category_id IS NOT NULL);

-- Index on public.construction_cost_volumes
CREATE UNIQUE INDEX construction_cost_volumes_tender_group_key ON public.construction_cost_volumes USING btree (tender_id, group_key) WHERE (group_key IS NOT NULL);

-- Index on public.construction_cost_volumes
CREATE INDEX idx_construction_cost_volumes_detail_cost ON public.construction_cost_volumes USING btree (detail_cost_category_id);

-- Index on public.construction_cost_volumes
CREATE INDEX idx_construction_cost_volumes_tender ON public.construction_cost_volumes USING btree (tender_id);

-- Index on public.cost_categories
CREATE INDEX idx_cost_categories_created_at ON public.cost_categories USING btree (created_at DESC);

-- Index on public.cost_categories
CREATE INDEX idx_cost_categories_name ON public.cost_categories USING btree (name);

-- Index on public.cost_categories
CREATE INDEX idx_cost_categories_unit ON public.cost_categories USING btree (unit);

-- Index on public.cost_redistribution_results
CREATE INDEX idx_redistribution_boq_item ON public.cost_redistribution_results USING btree (boq_item_id);

-- Index on public.cost_redistribution_results
CREATE INDEX idx_redistribution_tender_tactic ON public.cost_redistribution_results USING btree (tender_id, markup_tactic_id);

-- Index on public.cost_redistribution_results
CREATE UNIQUE INDEX uq_cost_redistribution_results_tender_tactic_boq ON public.cost_redistribution_results USING btree (tender_id, markup_tactic_id, boq_item_id);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_category ON public.detail_cost_categories USING btree (cost_category_id);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_category_id ON public.detail_cost_categories USING btree (cost_category_id);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_composite ON public.detail_cost_categories USING btree (cost_category_id, location);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_location ON public.detail_cost_categories USING btree (location);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_name ON public.detail_cost_categories USING btree (name);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_order_num ON public.detail_cost_categories USING btree (order_num);

-- Index on public.detail_cost_categories
CREATE INDEX idx_detail_cost_categories_unit ON public.detail_cost_categories USING btree (unit);

-- Index on public.markup_parameters
CREATE INDEX idx_markup_parameters_is_active ON public.markup_parameters USING btree (is_active);

-- Index on public.markup_parameters
CREATE INDEX idx_markup_parameters_key ON public.markup_parameters USING btree (key);

-- Index on public.markup_parameters
CREATE INDEX idx_markup_parameters_order_num ON public.markup_parameters USING btree (order_num);

-- Index on public.markup_parameters
CREATE UNIQUE INDEX markup_parameters_key_key ON public.markup_parameters USING btree (key);

-- Index on public.markup_tactics
CREATE INDEX idx_markup_tactics_created_at ON public.markup_tactics USING btree (created_at DESC);

-- Index on public.markup_tactics
CREATE INDEX idx_markup_tactics_is_global ON public.markup_tactics USING btree (is_global);

-- Index on public.markup_tactics
CREATE INDEX idx_markup_tactics_user_id ON public.markup_tactics USING btree (user_id);

-- Index on public.material_names
CREATE INDEX idx_material_names_name ON public.material_names USING btree (name);

-- Index on public.material_names
CREATE INDEX idx_material_names_unit ON public.material_names USING btree (unit);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_created_at ON public.materials_library USING btree (created_at DESC);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_currency_type ON public.materials_library USING btree (currency_type);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_delivery_price_type ON public.materials_library USING btree (delivery_price_type);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_item_type ON public.materials_library USING btree (item_type);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_material_name_id ON public.materials_library USING btree (material_name_id);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_material_type ON public.materials_library USING btree (material_type);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_name ON public.materials_library USING btree (material_name_id);

-- Index on public.materials_library
CREATE INDEX idx_materials_library_type_currency ON public.materials_library USING btree (material_type, currency_type);

-- Index on public.roles
CREATE UNIQUE INDEX roles_name_key ON public.roles USING btree (name);

-- Index on public.subcontract_growth_exclusions
CREATE UNIQUE INDEX subcontract_growth_exclusions_unique ON public.subcontract_growth_exclusions USING btree (tender_id, detail_cost_category_id, exclusion_type);

-- Index on public.template_items
CREATE INDEX idx_template_items_detail_cost ON public.template_items USING btree (detail_cost_category_id) WHERE (detail_cost_category_id IS NOT NULL);

-- Index on public.template_items
CREATE INDEX idx_template_items_detail_cost_category_id ON public.template_items USING btree (detail_cost_category_id);

-- Index on public.template_items
CREATE INDEX idx_template_items_kind ON public.template_items USING btree (kind);

-- Index on public.template_items
CREATE INDEX idx_template_items_material_library ON public.template_items USING btree (material_library_id) WHERE (material_library_id IS NOT NULL);

-- Index on public.template_items
CREATE INDEX idx_template_items_material_library_id ON public.template_items USING btree (material_library_id);

-- Index on public.template_items
CREATE INDEX idx_template_items_parent_work_item_id ON public.template_items USING btree (parent_work_item_id);

-- Index on public.template_items
CREATE INDEX idx_template_items_template_id ON public.template_items USING btree (template_id);

-- Index on public.template_items
CREATE INDEX idx_template_items_template_position ON public.template_items USING btree (template_id, "position");

-- Index on public.template_items
CREATE INDEX idx_template_items_work_library ON public.template_items USING btree (work_library_id) WHERE (work_library_id IS NOT NULL);

-- Index on public.template_items
CREATE INDEX idx_template_items_work_library_id ON public.template_items USING btree (work_library_id);

-- Index on public.templates
CREATE INDEX idx_templates_detail_cost_category_id ON public.templates USING btree (detail_cost_category_id);

-- Index on public.tender_documents
CREATE INDEX idx_tender_documents_content_fts ON public.tender_documents USING gin (to_tsvector('russian'::regconfig, content_markdown));

-- Index on public.tender_documents
CREATE INDEX idx_tender_documents_section ON public.tender_documents USING btree (section_type);

-- Index on public.tender_documents
CREATE INDEX idx_tender_documents_tender ON public.tender_documents USING btree (tender_id);

-- Index on public.tender_documents
CREATE INDEX idx_tender_documents_uploaded ON public.tender_documents USING btree (upload_date DESC);

-- Index on public.tender_documents
CREATE UNIQUE INDEX unique_tender_section_file ON public.tender_documents USING btree (tender_id, section_type, original_filename);

-- Index on public.tender_markup_percentage
CREATE INDEX idx_tender_markup_percentage_markup_parameter_id ON public.tender_markup_percentage USING btree (markup_parameter_id);

-- Index on public.tender_markup_percentage
CREATE INDEX idx_tender_markup_percentage_tender_id ON public.tender_markup_percentage USING btree (tender_id);

-- Index on public.tender_markup_percentage
CREATE UNIQUE INDEX tender_markup_percentage_unique ON public.tender_markup_percentage USING btree (tender_id, markup_parameter_id);

-- Index on public.tender_pricing_distribution
CREATE INDEX idx_tender_pricing_distribution_tactic_id ON public.tender_pricing_distribution USING btree (markup_tactic_id);

-- Index on public.tender_pricing_distribution
CREATE INDEX idx_tender_pricing_distribution_tender_id ON public.tender_pricing_distribution USING btree (tender_id);

-- Index on public.tender_pricing_distribution
CREATE UNIQUE INDEX tender_pricing_distribution_tender_id_markup_tactic_id_key ON public.tender_pricing_distribution USING btree (tender_id, markup_tactic_id);

-- Index on public.tenders
CREATE INDEX idx_tenders_client_name ON public.tenders USING btree (client_name);

-- Index on public.tenders
CREATE INDEX idx_tenders_created_at ON public.tenders USING btree (created_at DESC);

-- Index on public.tenders
CREATE INDEX idx_tenders_is_archived ON public.tenders USING btree (is_archived);

-- Index on public.tenders
CREATE INDEX idx_tenders_submission_deadline ON public.tenders USING btree (submission_deadline);

-- Index on public.tenders
CREATE INDEX idx_tenders_tender_number ON public.tenders USING btree (tender_number);

-- Index on public.tenders
CREATE UNIQUE INDEX tenders_tender_number_version_key ON public.tenders USING btree (tender_number, version);

-- Index on public.units
CREATE INDEX idx_units_category ON public.units USING btree (category);

-- Index on public.units
CREATE INDEX idx_units_is_active ON public.units USING btree (is_active);

-- Index on public.units
CREATE INDEX idx_units_sort_order ON public.units USING btree (sort_order);

-- Index on public.user_position_filters
CREATE INDEX idx_user_position_filters_position ON public.user_position_filters USING btree (position_id);

-- Index on public.user_position_filters
CREATE INDEX idx_user_position_filters_user_tender ON public.user_position_filters USING btree (user_id, tender_id);

-- Index on public.user_position_filters
CREATE UNIQUE INDEX unique_user_tender_position ON public.user_position_filters USING btree (user_id, tender_id, position_id);

-- Index on public.user_tasks
CREATE INDEX idx_user_tasks_status ON public.user_tasks USING btree (task_status);

-- Index on public.user_tasks
CREATE INDEX idx_user_tasks_tender_id ON public.user_tasks USING btree (tender_id);

-- Index on public.user_tasks
CREATE INDEX idx_user_tasks_user_id ON public.user_tasks USING btree (user_id);

-- Index on public.users
CREATE INDEX idx_users_access_status ON public.users USING btree (access_status);

-- Index on public.users
CREATE INDEX idx_users_approved_by ON public.users USING btree (approved_by);

-- Index on public.users
CREATE INDEX idx_users_deadline_extensions ON public.users USING gin (tender_deadline_extensions);

-- Index on public.users
CREATE INDEX idx_users_email ON public.users USING btree (email);

-- Index on public.users
CREATE INDEX idx_users_role_code ON public.users USING btree (role_code);

-- Index on public.users
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

-- Index on public.work_names
CREATE INDEX idx_work_names_name ON public.work_names USING btree (name);

-- Index on public.work_names
CREATE INDEX idx_work_names_unit ON public.work_names USING btree (unit);

-- Index on public.works_library
CREATE INDEX idx_works_library_created_at ON public.works_library USING btree (created_at DESC);

-- Index on public.works_library
CREATE INDEX idx_works_library_currency_type ON public.works_library USING btree (currency_type);

-- Index on public.works_library
CREATE INDEX idx_works_library_item_type ON public.works_library USING btree (item_type);

-- Index on public.works_library
CREATE INDEX idx_works_library_name ON public.works_library USING btree (work_name_id);

-- Index on public.works_library
CREATE INDEX idx_works_library_type_currency ON public.works_library USING btree (item_type, currency_type);

-- Index on public.works_library
CREATE INDEX idx_works_library_work_name_id ON public.works_library USING btree (work_name_id);

-- Index on realtime.messages
CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2025_12_27
CREATE INDEX messages_2025_12_27_inserted_at_topic_idx ON realtime.messages_2025_12_27 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2025_12_28
CREATE INDEX messages_2025_12_28_inserted_at_topic_idx ON realtime.messages_2025_12_28 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2025_12_29
CREATE INDEX messages_2025_12_29_inserted_at_topic_idx ON realtime.messages_2025_12_29 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2025_12_30
CREATE INDEX messages_2025_12_30_inserted_at_topic_idx ON realtime.messages_2025_12_30 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2025_12_31
CREATE INDEX messages_2025_12_31_inserted_at_topic_idx ON realtime.messages_2025_12_31 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2026_01_01
CREATE INDEX messages_2026_01_01_inserted_at_topic_idx ON realtime.messages_2026_01_01 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.messages_2026_01_02
CREATE INDEX messages_2026_01_02_inserted_at_topic_idx ON realtime.messages_2026_01_02 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

-- Index on realtime.subscription
CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);

-- Index on realtime.subscription
CREATE UNIQUE INDEX pk_subscription ON realtime.subscription USING btree (id);

-- Index on realtime.subscription
CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_key ON realtime.subscription USING btree (subscription_id, entity, filters);

-- Index on storage.buckets
CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);

-- Index on storage.buckets_analytics
CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);

-- Index on storage.migrations
CREATE UNIQUE INDEX migrations_name_key ON storage.migrations USING btree (name);

-- Index on storage.objects
CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);

-- Index on storage.objects
CREATE UNIQUE INDEX idx_name_bucket_level_unique ON storage.objects USING btree (name COLLATE "C", bucket_id, level);

-- Index on storage.objects
CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");

-- Index on storage.objects
CREATE INDEX idx_objects_lower_name ON storage.objects USING btree ((path_tokens[level]), lower(name) text_pattern_ops, bucket_id, level);

-- Index on storage.objects
CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);

-- Index on storage.objects
CREATE UNIQUE INDEX objects_bucket_id_level_idx ON storage.objects USING btree (bucket_id, level, name COLLATE "C");

-- Index on storage.prefixes
CREATE INDEX idx_prefixes_lower_name ON storage.prefixes USING btree (bucket_id, level, ((string_to_array(name, '/'::text))[level]), lower(name) text_pattern_ops);

-- Index on storage.s3_multipart_uploads
CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);

-- Index on storage.vector_indexes
CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);

-- Index on vault.secrets
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets USING btree (name) WHERE (name IS NOT NULL);


-- ============================================
-- ROLES AND PRIVILEGES
-- ============================================

-- Role: anon
CREATE ROLE anon;
-- Members of role anon:
-- - authenticator
-- - postgres (WITH ADMIN OPTION)
-- Database privileges for anon:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO anon;
-- Schema privileges for anon:
-- GRANT USAGE ON SCHEMA auth TO anon;
-- GRANT USAGE ON SCHEMA extensions TO anon;
-- GRANT USAGE ON SCHEMA graphql TO anon;
-- GRANT USAGE ON SCHEMA graphql_public TO anon;
-- GRANT USAGE ON SCHEMA public TO anon;
-- GRANT USAGE ON SCHEMA realtime TO anon;
-- GRANT USAGE ON SCHEMA storage TO anon;

-- Role: authenticated
CREATE ROLE authenticated;
-- Members of role authenticated:
-- - authenticator
-- - postgres (WITH ADMIN OPTION)
-- Database privileges for authenticated:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO authenticated;
-- Schema privileges for authenticated:
-- GRANT USAGE ON SCHEMA auth TO authenticated;
-- GRANT USAGE ON SCHEMA extensions TO authenticated;
-- GRANT USAGE ON SCHEMA graphql TO authenticated;
-- GRANT USAGE ON SCHEMA graphql_public TO authenticated;
-- GRANT USAGE ON SCHEMA public TO authenticated;
-- GRANT USAGE ON SCHEMA realtime TO authenticated;
-- GRANT USAGE ON SCHEMA storage TO authenticated;

-- Role: authenticator
CREATE ROLE authenticator WITH LOGIN NOINHERIT;
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
-- Members of role authenticator:
-- - postgres (WITH ADMIN OPTION)
-- - supabase_storage_admin
-- Database privileges for authenticator:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO authenticator;
-- Schema privileges for authenticator:
-- GRANT USAGE ON SCHEMA public TO authenticator;

-- Role: cli_login_postgres
CREATE ROLE cli_login_postgres WITH LOGIN NOINHERIT VALID UNTIL '2025-11-24 08:36:06.867941+00';
GRANT postgres TO cli_login_postgres;
-- Database privileges for cli_login_postgres:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO cli_login_postgres;
-- Schema privileges for cli_login_postgres:
-- GRANT USAGE ON SCHEMA public TO cli_login_postgres;

-- Role: dashboard_user
CREATE ROLE dashboard_user WITH CREATEDB CREATEROLE REPLICATION;
-- Database privileges for dashboard_user:
-- GRANT CONNECT, CREATE, TEMP ON DATABASE postgres TO dashboard_user;
-- Schema privileges for dashboard_user:
-- GRANT CREATE, USAGE ON SCHEMA auth TO dashboard_user;
-- GRANT CREATE, USAGE ON SCHEMA extensions TO dashboard_user;
-- GRANT USAGE ON SCHEMA public TO dashboard_user;
-- GRANT CREATE, USAGE ON SCHEMA storage TO dashboard_user;

-- Role: postgres
CREATE ROLE postgres WITH CREATEDB CREATEROLE LOGIN REPLICATION BYPASSRLS;
GRANT anon TO postgres WITH ADMIN OPTION;
GRANT authenticated TO postgres WITH ADMIN OPTION;
GRANT authenticator TO postgres WITH ADMIN OPTION;
GRANT pg_create_subscription TO postgres WITH ADMIN OPTION;
GRANT pg_monitor TO postgres WITH ADMIN OPTION;
GRANT pg_read_all_data TO postgres WITH ADMIN OPTION;
GRANT pg_signal_backend TO postgres WITH ADMIN OPTION;
GRANT service_role TO postgres WITH ADMIN OPTION;
GRANT supabase_realtime_admin TO postgres;
-- Members of role postgres:
-- - cli_login_postgres
-- Database privileges for postgres:
-- GRANT CONNECT, CREATE, TEMP ON DATABASE postgres TO postgres;
-- Schema privileges for postgres:
-- GRANT USAGE ON SCHEMA auth TO postgres;
-- GRANT CREATE, USAGE ON SCHEMA extensions TO postgres;
-- GRANT USAGE ON SCHEMA graphql TO postgres;
-- GRANT USAGE ON SCHEMA graphql_public TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_0 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_1 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_10 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_11 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_12 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_13 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_14 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_15 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_16 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_17 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_18 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_19 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_2 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_20 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_21 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_22 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_23 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_24 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_25 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_27 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_28 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_29 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_3 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_30 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_31 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_32 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_33 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_34 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_35 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_36 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_37 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_38 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_4 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_40 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_41 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_42 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_43 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_44 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_45 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_46 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_47 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_48 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_49 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_5 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_50 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_51 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_52 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_53 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_54 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_55 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_56 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_57 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_58 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_59 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_7 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_8 TO postgres;
-- GRANT USAGE ON SCHEMA pg_temp_9 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_0 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_1 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_10 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_11 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_12 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_13 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_14 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_15 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_16 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_17 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_18 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_19 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_2 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_20 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_21 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_22 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_23 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_24 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_25 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_27 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_28 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_29 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_3 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_30 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_31 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_32 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_33 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_34 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_35 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_36 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_37 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_38 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_4 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_40 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_41 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_42 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_43 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_44 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_45 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_46 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_47 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_48 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_49 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_5 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_50 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_51 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_52 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_53 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_54 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_55 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_56 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_57 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_58 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_59 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_7 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_8 TO postgres;
-- GRANT USAGE ON SCHEMA pg_toast_temp_9 TO postgres;
-- GRANT USAGE ON SCHEMA pgbouncer TO postgres;
-- GRANT CREATE, USAGE ON SCHEMA public TO postgres;
-- GRANT CREATE, USAGE ON SCHEMA realtime TO postgres;
-- GRANT USAGE ON SCHEMA storage TO postgres;
-- GRANT CREATE, USAGE ON SCHEMA supabase_migrations TO postgres;
-- GRANT USAGE ON SCHEMA vault TO postgres;

-- Role: service_role
CREATE ROLE service_role WITH BYPASSRLS;
-- Members of role service_role:
-- - authenticator
-- - postgres (WITH ADMIN OPTION)
-- Database privileges for service_role:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO service_role;
-- Schema privileges for service_role:
-- GRANT USAGE ON SCHEMA auth TO service_role;
-- GRANT USAGE ON SCHEMA extensions TO service_role;
-- GRANT USAGE ON SCHEMA graphql TO service_role;
-- GRANT USAGE ON SCHEMA graphql_public TO service_role;
-- GRANT USAGE ON SCHEMA public TO service_role;
-- GRANT USAGE ON SCHEMA realtime TO service_role;
-- GRANT USAGE ON SCHEMA storage TO service_role;
-- GRANT USAGE ON SCHEMA vault TO service_role;

-- Role: supabase_admin
CREATE ROLE supabase_admin WITH SUPERUSER CREATEDB CREATEROLE LOGIN REPLICATION BYPASSRLS;
-- Database privileges for supabase_admin:
-- GRANT CONNECT, CREATE, TEMP ON DATABASE postgres TO supabase_admin;
-- Schema privileges for supabase_admin:
-- GRANT CREATE, USAGE ON SCHEMA auth TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA extensions TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA graphql TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA graphql_public TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_0 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_1 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_10 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_11 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_12 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_13 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_14 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_15 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_16 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_17 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_18 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_19 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_2 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_20 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_21 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_22 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_23 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_24 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_25 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_27 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_28 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_29 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_3 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_30 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_31 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_32 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_33 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_34 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_35 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_36 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_37 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_38 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_4 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_40 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_41 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_42 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_43 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_44 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_45 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_46 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_47 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_48 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_49 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_5 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_50 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_51 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_52 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_53 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_54 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_55 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_56 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_57 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_58 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_59 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_7 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_8 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_temp_9 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_0 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_1 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_10 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_11 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_12 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_13 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_14 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_15 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_16 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_17 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_18 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_19 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_2 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_20 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_21 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_22 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_23 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_24 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_25 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_27 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_28 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_29 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_3 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_30 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_31 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_32 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_33 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_34 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_35 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_36 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_37 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_38 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_4 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_40 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_41 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_42 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_43 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_44 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_45 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_46 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_47 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_48 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_49 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_5 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_50 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_51 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_52 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_53 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_54 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_55 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_56 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_57 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_58 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_59 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_7 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_8 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pg_toast_temp_9 TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA pgbouncer TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA public TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA realtime TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA storage TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA supabase_migrations TO supabase_admin;
-- GRANT CREATE, USAGE ON SCHEMA vault TO supabase_admin;

-- Role: supabase_auth_admin
CREATE ROLE supabase_auth_admin WITH CREATEROLE LOGIN NOINHERIT;
-- Database privileges for supabase_auth_admin:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO supabase_auth_admin;
-- Schema privileges for supabase_auth_admin:
-- GRANT CREATE, USAGE ON SCHEMA auth TO supabase_auth_admin;
-- GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Role: supabase_etl_admin
CREATE ROLE supabase_etl_admin WITH LOGIN REPLICATION;
GRANT pg_monitor TO supabase_etl_admin;
GRANT pg_read_all_data TO supabase_etl_admin;
-- Database privileges for supabase_etl_admin:
-- GRANT CONNECT, CREATE, TEMP ON DATABASE postgres TO supabase_etl_admin;
-- Schema privileges for supabase_etl_admin:
-- GRANT USAGE ON SCHEMA auth TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA extensions TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA graphql TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA graphql_public TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_0 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_1 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_10 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_11 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_12 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_13 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_14 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_15 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_16 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_17 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_18 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_19 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_2 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_20 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_21 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_22 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_23 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_24 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_25 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_27 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_28 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_29 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_3 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_30 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_31 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_32 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_33 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_34 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_35 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_36 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_37 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_38 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_4 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_40 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_41 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_42 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_43 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_44 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_45 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_46 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_47 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_48 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_49 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_5 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_50 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_51 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_52 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_53 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_54 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_55 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_56 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_57 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_58 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_59 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_7 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_8 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_temp_9 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_0 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_1 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_10 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_11 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_12 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_13 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_14 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_15 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_16 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_17 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_18 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_19 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_2 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_20 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_21 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_22 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_23 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_24 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_25 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_27 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_28 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_29 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_3 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_30 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_31 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_32 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_33 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_34 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_35 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_36 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_37 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_38 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_4 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_40 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_41 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_42 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_43 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_44 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_45 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_46 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_47 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_48 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_49 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_5 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_50 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_51 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_52 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_53 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_54 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_55 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_56 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_57 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_58 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_59 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_7 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_8 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pg_toast_temp_9 TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA pgbouncer TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA public TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA realtime TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA storage TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA supabase_migrations TO supabase_etl_admin;
-- GRANT USAGE ON SCHEMA vault TO supabase_etl_admin;

-- Role: supabase_read_only_user
CREATE ROLE supabase_read_only_user WITH LOGIN BYPASSRLS;
GRANT pg_monitor TO supabase_read_only_user;
GRANT pg_read_all_data TO supabase_read_only_user;
-- Database privileges for supabase_read_only_user:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO supabase_read_only_user;
-- Schema privileges for supabase_read_only_user:
-- GRANT USAGE ON SCHEMA auth TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA extensions TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA graphql TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA graphql_public TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_0 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_1 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_10 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_11 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_12 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_13 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_14 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_15 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_16 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_17 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_18 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_19 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_2 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_20 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_21 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_22 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_23 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_24 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_25 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_27 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_28 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_29 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_3 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_30 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_31 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_32 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_33 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_34 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_35 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_36 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_37 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_38 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_4 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_40 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_41 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_42 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_43 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_44 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_45 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_46 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_47 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_48 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_49 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_5 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_50 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_51 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_52 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_53 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_54 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_55 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_56 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_57 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_58 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_59 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_7 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_8 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_temp_9 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_0 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_1 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_10 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_11 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_12 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_13 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_14 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_15 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_16 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_17 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_18 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_19 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_2 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_20 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_21 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_22 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_23 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_24 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_25 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_27 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_28 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_29 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_3 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_30 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_31 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_32 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_33 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_34 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_35 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_36 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_37 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_38 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_4 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_40 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_41 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_42 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_43 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_44 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_45 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_46 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_47 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_48 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_49 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_5 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_50 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_51 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_52 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_53 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_54 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_55 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_56 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_57 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_58 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_59 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_7 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_8 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pg_toast_temp_9 TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA pgbouncer TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA public TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA realtime TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA storage TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA supabase_migrations TO supabase_read_only_user;
-- GRANT USAGE ON SCHEMA vault TO supabase_read_only_user;

-- Role: supabase_realtime_admin
CREATE ROLE supabase_realtime_admin WITH NOINHERIT;
-- Members of role supabase_realtime_admin:
-- - postgres
-- Database privileges for supabase_realtime_admin:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO supabase_realtime_admin;
-- Schema privileges for supabase_realtime_admin:
-- GRANT USAGE ON SCHEMA public TO supabase_realtime_admin;
-- GRANT CREATE, USAGE ON SCHEMA realtime TO supabase_realtime_admin;

-- Role: supabase_replication_admin
CREATE ROLE supabase_replication_admin WITH LOGIN REPLICATION;
-- Database privileges for supabase_replication_admin:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO supabase_replication_admin;
-- Schema privileges for supabase_replication_admin:
-- GRANT USAGE ON SCHEMA public TO supabase_replication_admin;

-- Role: supabase_storage_admin
CREATE ROLE supabase_storage_admin WITH CREATEROLE LOGIN NOINHERIT;
GRANT authenticator TO supabase_storage_admin;
-- Database privileges for supabase_storage_admin:
-- GRANT CONNECT, TEMP ON DATABASE postgres TO supabase_storage_admin;
-- Schema privileges for supabase_storage_admin:
-- GRANT USAGE ON SCHEMA public TO supabase_storage_admin;
-- GRANT CREATE, USAGE ON SCHEMA storage TO supabase_storage_admin;
