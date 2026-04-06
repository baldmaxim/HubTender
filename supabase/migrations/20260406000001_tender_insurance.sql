-- Таблица страхования от судимостей по тендеру
CREATE TABLE IF NOT EXISTS public.tender_insurance (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    tender_id uuid NOT NULL,
    judicial_pct numeric(10,4) NOT NULL DEFAULT 0,     -- % судебных квартир
    total_pct numeric(10,4) NOT NULL DEFAULT 0,         -- % от общей суммы
    apt_price_m2 numeric(12,2) NOT NULL DEFAULT 0,      -- цена за м2 квартиры
    apt_area numeric(12,2) NOT NULL DEFAULT 0,          -- площадь квартир
    parking_price_m2 numeric(12,2) NOT NULL DEFAULT 0,  -- цена за м2 парковки
    parking_area numeric(12,2) NOT NULL DEFAULT 0,      -- площадь парковок
    storage_price_m2 numeric(12,2) NOT NULL DEFAULT 0,  -- цена за м2 кладовки
    storage_area numeric(12,2) NOT NULL DEFAULT 0,      -- площадь кладовок
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tender_insurance_pkey PRIMARY KEY (id),
    CONSTRAINT tender_insurance_tender_id_fkey FOREIGN KEY (tender_id)
        REFERENCES public.tenders(id) ON DELETE CASCADE,
    CONSTRAINT tender_insurance_tender_id_unique UNIQUE (tender_id)
);

COMMENT ON TABLE public.tender_insurance IS 'Параметры страхования от судимостей по тендеру';
COMMENT ON COLUMN public.tender_insurance.judicial_pct IS '% судебных квартир';
COMMENT ON COLUMN public.tender_insurance.total_pct IS '% от общей суммы';

ALTER TABLE public.tender_insurance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Все пользователи могут просматривать страхование"
    ON public.tender_insurance FOR SELECT USING (true);

CREATE POLICY "Авторизованные пользователи могут изменять страхование"
    ON public.tender_insurance FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER update_tender_insurance_updated_at
    BEFORE UPDATE ON public.tender_insurance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_tender_insurance_tender_id ON public.tender_insurance USING btree (tender_id);
