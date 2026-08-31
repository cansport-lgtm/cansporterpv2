-- Restore KPI description text that an earlier partial import had trimmed, and set
-- PRD4ARL's category, which was NULL in v2. Values are taken verbatim from the v1 backup.

UPDATE public.performance_kpis SET description='Solvent Authorize For Production Limit vs Solvent Loss
' WHERE id='ac5bcc18-3640-491d-9c91-9a0054dd14f8';
UPDATE public.performance_kpis SET description='Total Lead Generation Target vs Actual Achieve Target
' WHERE id='a8bcf2b7-69f6-4bcc-8e2c-bf9aa0469ae3';
UPDATE public.performance_kpis SET description='All Product Availability Total Product on shop  vs Actual Achieve Target
' WHERE id='bc81e53e-c30c-4f4a-b7be-3a50b6e68f10';
UPDATE public.performance_kpis SET description='All Client List two time in month vs Visit Done In Month
' WHERE id='6fe23655-e5a2-4b11-971d-e0c677e39f6a';
UPDATE public.performance_kpis SET description='Solvent Authorize For Production Limit vs Solvent Loss
' WHERE id='dd761565-84e9-41b8-b4c1-a6f499f50528';
UPDATE public.performance_kpis SET description='Plan Given production Target vs Achieved Production
' WHERE id='b25f70cd-48b1-4977-b646-c87f99b84952';
UPDATE public.performance_kpis SET description='Targeted Activities Vs Complately Done
' WHERE id='5379671c-a4ef-4604-bffd-5dec09f3398c';
UPDATE public.performance_kpis SET description='KPI Report Completed Before Deadline
' WHERE id='ec994ed0-7761-44aa-8c33-1c1496ee8996';
UPDATE public.performance_kpis SET description='Lowest Quantity of CPA against  vs Target Allowed' WHERE id='0b11043e-20e9-4b82-a78a-3a00a7d3ffef';
UPDATE public.performance_kpis SET description='Kapra Depart ka target 20 ag pr lana hai' WHERE id='0465275a-8309-4020-8c96-a0a772e613f9';
UPDATE public.performance_monthly_kpis SET description='Inspection Target Vs Achivement

80% Se Kam hone pr 0 Score ho jaiga (jis Inspection ka target Per day btaya gaya hai os ka target related Supervisor Se pora krwana hoga or oski Monthly Percentage of Achivement pr Score Calculate hoga or Arsalan ko Inspection Report daily Submit krwani hogi)' WHERE id='2e6f51ba-5d21-4396-9424-6a3a61fc6134';
UPDATE public.performance_kpis SET category='Quality' WHERE id='ac5bcc18-3640-491d-9c91-9a0054dd14f8';
