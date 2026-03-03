-- 004_core_tariffs_seed_202310.sql
-- SONABEL - Grille applicable à partir du 01/10/2023 (plans D/E/G)

INSERT INTO tariff_plans
(group_code, plan_code, name, valid_from, hp_start_min, hp_end_min, hpt_start_min, hpt_end_min, rate_hp, rate_hpt, fixed_monthly, prime_per_kw)
VALUES
-- D : 00:00-17:00 HP ; 17:00-24:00 HPT
('D','D1','D1 Non industriel (SONABEL 2023-10)', '2023-10-01', 0,1020, 1020,1440, 88,165, 8538, 2882),
('D','D2','D2 Industriel (SONABEL 2023-10)',     '2023-10-01', 0,1020, 1020,1440, 75,140, 7115, 2402),
('D','D3','D3 Spécial (SONABEL 2023-10)',        '2023-10-01', 0,1020, 1020,1440, 160,160,8538, 2882),

-- E : 00:00-17:00 HP ; 17:00-24:00 HPT
('E','E1','E1 Non industriel (SONABEL 2023-10)', '2023-10-01', 0,1020, 1020,1440, 64,139, 8538, 5903),
('E','E2','E2 Industriel (SONABEL 2023-10)',     '2023-10-01', 0,1020, 1020,1440, 54,118, 7115, 5366),
('E','E3','E3 Spécial (SONABEL 2023-10)',        '2023-10-01', 0,1020, 1020,1440, 160,160,8538, 5903),

-- G : 00:00-10:00 HP ; 10:00-24:00 HPT
('G','G','G (SONABEL 2023-10)',                  '2023-10-01', 0,600,  600,1440, 70,140, 7115, 5366)
ON CONFLICT DO NOTHING;