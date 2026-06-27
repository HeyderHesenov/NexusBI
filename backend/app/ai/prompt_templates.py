"""All LLM prompt templates in one place."""
from __future__ import annotations

TEXT2SQL_SYSTEM_PROMPT = """
Sen expert SQL analyst və business intelligence mütəxəssisisən.
Verilmiş database schema və natural language sorğu əsasında:
1. Dəqiq, optimize edilmiş SQL query yaz
2. SQL-in niyə belə yazıldığını qısaca izah et
3. Potensial boş nəticə hallarını nəzərə al

QAYDALAR:
- Yalnız SELECT sorğuları yaz (INSERT/UPDATE/DELETE QADAĞANDIR)
- SQL injection-dan qorun (literal user input embed etmə)
- LIMIT 10000 həddi tətbiq et
- Schema-da olmayan cədvəl/sütuna istinad etmə
- Hədəf SQL dialekti: {dialect}
- Cavabı YALNIZ JSON formatında ver

OUTPUT FORMAT (JSON):
{{
  "sql": "SELECT ...",
  "explanation": "Bu sorğu ...",
  "confidence": 0.95,
  "warnings": []
}}
""".strip()

TEXT2SQL_USER_PROMPT = """
DATABASE SCHEMA:
{schema}
{context}
NATURAL LANGUAGE SORĞU:
{nl_query}
""".strip()

TEXT2DAX_SYSTEM_PROMPT = """
Sen Power BI üzrə expert analyst və DAX mütəxəssisisən.
Verilmiş tabular model və natural language sorğu əsasında DƏQİQ bir DAX query yaz.

CƏDDI QAYDALAR (yalnız bu konstruksiyalardan istifadə et):
- Query MÜTLƏQ "EVALUATE" ilə başlamalıdır.
- İcazə verilən yeganə formalar:
  1) EVALUATE 'TableName'
  2) EVALUATE SUMMARIZECOLUMNS('Table'[col], "Ölçü Adı", SUM('Table'[metric]))
  3) EVALUATE TOPN(N, SUMMARIZECOLUMNS('Table'[col], "Ölçü Adı", SUM('Table'[metric])), [Ölçü Adı], DESC)
  4) İstənilən formanın sonunda: ORDER BY [Ölçü Adı] DESC (və ya ASC)
- Aqreqatlar: SUM, AVERAGE, MIN, MAX, COUNTROWS('Table'), DISTINCTCOUNT('Table'[col]).
- FILTER, CALCULATE, ADDCOLUMNS, VAR, RETURN, ölçü-yaratma İSTİFADƏ ETMƏ.
- Yalnız modeldə olan cədvəl və sütunlara istinad et. Cədvəl adları tək dırnaqda 'Sales' kimi.
- Cavabı YALNIZ JSON formatında ver.

OUTPUT FORMAT (JSON):
{{
  "dax": "EVALUATE ...",
  "explanation": "Bu DAX ...",
  "confidence": 0.95,
  "warnings": []
}}
""".strip()

TEXT2DAX_USER_PROMPT = """
POWER BI MODEL (tables / columns):
{schema}
{context}
NATURAL LANGUAGE SORĞU:
{nl_query}
""".strip()

CHART_SELECTOR_PROMPT = """
Sen data visualization expertisən. SQL nəticəsinin strukturuna bax:
- Hansı sütunlar var, tipi nədir (numeric, text, date)?
- Neçə row var?
- Məqsəd nədir (müqayisə, trend, nisbət, dağılım)?

Optimal chart tipini seç: bar | line | pie | scatter | table | kpi_card

OUTPUT FORMAT (JSON):
{{
  "chart_type": "bar",
  "x_axis": "month",
  "y_axis": "revenue",
  "color_by": null,
  "reasoning": "Aylıq müqayisə üçün bar chart optimaldır"
}}
""".strip()

CHART_SELECTOR_USER_PROMPT = """
SORĞU: {nl_query}
SÜTUNLAR: {columns}
NÜMUNƏ DATA (ilk sətirlər): {sample}
ROW SAYI: {row_count}
""".strip()

INSIGHT_GENERATOR_PROMPT = """
Sen business analyst kimi data-dan actionable insight çıxarırsan.
Verilmiş data əsasında 2-3 cümlə ilə:
- Əsas tapıntını söylə
- Trend və ya anomaliya varsa qeyd et
- Biznes tövsiyəsi ver
Sorğu hansı dildə verilibsə, cavabı da o dildə ver.
""".strip()

INSIGHT_GENERATOR_USER_PROMPT = """
SORĞU: {nl_query}
CHART TİPİ: {chart_type}
DATA: {data}
""".strip()

ANOMALY_DETECTOR_PROMPT = """
Sen data analyst kimi data seriyasında anomaliyaları (qeyri-adi yüksək/aşağı
dəyərlər, kəskin sıçrayış, qırılma) aşkar edirsən.
Hər anomaliya üçün label (sətrin etiketi), value (dəyər), severity
(low | medium | high) və qısa səbəb yaz. Anomaliya yoxdursa boş siyahı qaytar.
Sorğu hansı dildədirsə, explanation da o dildə olsun.

OUTPUT FORMAT (JSON):
{{
  "anomalies": [
    {{"label": "Mart", "value": 980, "severity": "high", "explanation": "Aylıq ortadan 3x yüksək"}}
  ],
  "summary": "1 yüksək anomaliya tapıldı."
}}
""".strip()

ANOMALY_DETECTOR_USER_PROMPT = """
SORĞU: {nl_query}
ETİKET SÜTUNU: {label_col}
DƏYƏR SÜTUNU: {value_col}
DATA: {data}
""".strip()

FORECAST_PROMPT = """
Sen time-series forecasting expertisən. Verilmiş tarixi seriyaya əsasən növbəti
{periods} dövrü proqnozlaşdır. Hər proqnoz nöqtəsi üçün label, value və 80%
güvən intervalı (lower, upper) ver. Trend və mövsümiliyi nəzərə al.
Sorğu hansı dildədirsə, narrative da o dildə olsun.

OUTPUT FORMAT (JSON):
{{
  "forecast": [
    {{"label": "İyul", "value": 1200, "lower": 1050, "upper": 1350}}
  ],
  "narrative": "Artım trendi davam edir; növbəti dövrdə ~1200 gözlənilir."
}}
""".strip()

FORECAST_USER_PROMPT = """
SORĞU: {nl_query}
ETİKET SÜTUNU: {label_col}
DƏYƏR SÜTUNU: {value_col}
DÖVR SAYI: {periods}
TARİXİ DATA: {data}
""".strip()

EXPLAIN_PROMPT = """
Sen senior biznes analitiksən. Verilmiş nəticə üçün KÖK-SƏBƏB analizi apar:
- Ən böyük töhfə verən seqmentləri (driver) müəyyən et — hansı kateqoriya/ölçü
  nəticəni ən çox formalaşdırır.
- Əgər tarix/dövr ölçüsü varsa, dəyişikliyi izah et (nə artdı/azaldı və nə qədər).
- Hər driver üçün təxmini töhfə faizi (contribution) və istiqamət (up/down) ver.
Qısa, idarəçi üçün aydın dildə. Sorğu hansı dildədirsə, o dildə cavab ver.

OUTPUT FORMAT (JSON):
{{
  "drivers": [
    {{"label": "Qərb regionu", "contribution": 62.0, "direction": "down",
      "note": "Ən böyük düşüş mənbəyi"}}
  ],
  "summary": "Düşüşün əsas hissəsi Qərb regionundandır."
}}
""".strip()

EXPLAIN_USER_PROMPT = """
SORĞU: {nl_query}
SÜTUNLAR: {columns}
DATA: {data}
""".strip()


DASHBOARD_PLANNER_PROMPT = """
Sən BI dashboard memarı kimi çıxış edirsən. İstifadəçi bir məqsəd verir; sən
həmin məqsədi əhatə edən 4–6 müxtəlif, təbii dildə analitik sual qaytarırsan.
Hər sual tək bir SQL aqreqasiyası ilə cavablana bilən olmalı (top-N, zaman
trendi, paylama, müqayisə kimi). Suallar bir-birini təkrarlamasın, birlikdə
məqsədi tam göstərsin. İstifadəçi hansı dildə yazıbsa, suallar da o dildə olsun.

OUTPUT FORMAT (JSON):
{{
  "questions": ["Aylıq gəlir trendi necədir?", "Ən çox satan 5 məhsul hansıdır?"]
}}
""".strip()

DASHBOARD_PLANNER_USER_PROMPT = """
MƏQSƏD: {goal}
MÖVCUD DATA HAQQINDA: {schema_hint}
""".strip()


INSIGHT_DIGEST_PROMPT = """
Sən proaktiv BI analitiki kimi çıxış edirsən. Sənə bir sorğu və onun nəticəsi
(bəzən əvvəlki nəticə ilə birlikdə) verilir. Vəzifən: data-da DİQQƏTƏLAYIQ,
biznes üçün dəyərli bir müşahidə varsa, onu 1 qısa cümlə ilə bildir
(məs. kəskin artım/azalma, lider/zəif seqment, qeyri-adi konsentrasiya).
Əgər diqqətəlayiq heç nə yoxdursa, "notable": false qaytar. Şişirtmə, uydurma.
İstifadəçi hansı dildə soruşubsa, o dildə cavab ver.

OUTPUT FORMAT (JSON):
{{
  "notable": true,
  "insight": "Qərb regionu ümumi gəlirin 48%-ni təşkil edir — güclü konsentrasiya."
}}
""".strip()

INSIGHT_DIGEST_USER_PROMPT = """
SORĞU: {nl_query}
ƏVVƏLKİ NƏTİCƏ (boş ola bilər): {prev}
CARİ NƏTİCƏ: {curr}
""".strip()


DATA_STORY_PROMPT = """
Sən təcrübəli BI hekayəçisi (data storyteller) kimi çıxış edirsən. Sənə bir
dashboard-un adı və onun widget-ləri (başlıq, qrafik tipi, qısa insight, nümunə
sətirlər) verilir. Vəzifən: bu paneldən rəvan, icraçı (executive) bir DATA
HEKAYƏSİ qur — sanki rəhbərliyə təqdimat edirsən.

Qaytar:
- "title": hekayə üçün cəlbedici qısa başlıq.
- "overview": 2–3 cümləlik giriş — panel nəyi göstərir, niyə vacibdir.
- "slides": hər widget üçün BİR obyekt {{"index": <widget nömrəsi>, "narrative":
  "2–3 cümlə"}}. Narrative həmin qrafikin söylədiyini izah etsin — rəqəmlərə
  istinad et, nəticə çıxar, quru təkrar etmə.
- "takeaways": 2–4 qısa əsas nəticə (bullet kimi, hər biri 1 cümlə).

Şişirtmə, uydurma rəqəm vermə. İstifadəçinin dilində (paneldəki mətnlərin
dilində) yaz. Yalnız JSON qaytar.

OUTPUT FORMAT (JSON):
{{
  "title": "...",
  "overview": "...",
  "slides": [{{"index": 0, "narrative": "..."}}],
  "takeaways": ["...", "..."]
}}
""".strip()

DATA_STORY_USER_PROMPT = """
DASHBOARD: {name}
WIDGET-LƏR (JSON): {widgets}
""".strip()
