-- Performance module v1->v2 data import
-- Source: cansport_db_backup_20260826. Idempotent: ON CONFLICT (id) DO NOTHING.

INSERT INTO public.performance_kpis (id,code,name,description,category,measurement_type,target_direction,min_value,max_value,unit,is_active,created_by,created_at,updated_at) VALUES
('6080e7b6-bb9e-4419-a1b5-9c9522467c34','ABR-03-JUNE','ACCOUNTS DEPARTMENT SIGNATURE','Signature on 3 physical Ledger.','Quality','boolean','higher','1.00','100.00',NULL,true,NULL,'2026-06-18 13:10:50.351224+00','2026-06-18 13:10:50.351224+00'),
('50c0bfca-623f-49bc-ae0b-ac0dec0664a2','ABR-01-JUNE MATERIAL','Ladger Balance Match Material Received','1)Material Received Updated.
2)Daily closing Reconciliation.
3)Accounts Department Signature. ','Quality','boolean','lower',NULL,NULL,NULL,true,NULL,'2026-06-18 13:04:30.358+00','2026-06-29 10:31:06.043235+00'),
('b08b3d7c-221d-48ff-a969-9a013b633767','ABR-02-JUNE','Daily closing Reconciliation','2)Daily closing Reconciliation.','Quality','boolean','higher','1.00','100.00',NULL,true,NULL,'2026-06-18 13:08:19.372405+00','2026-06-29 10:31:34.659248+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.performance_monthly_kpis (id,code,name,description,category,weight,max_score,is_active,created_at,updated_at) VALUES
('3a6f0017-4e20-4757-bcbd-d7714ed017c1','KPI-G2','Follow-Up Recovery Calls/Visits','minimum 8 Parties Call for Recovery Follow-Up if the Follow-Up lower then 8 the Score will be 0','Productivity','20','100',true,'2026-03-28 05:32:36.628347+00','2026-04-15 09:04:31.753773+00'),
('8afda6c6-f339-40cb-9611-2991b63f57aa','KPI-ABR05','5S Audits','4 audits Per Month Report Submission to Director Each Audit Points 1
','general','10','4',true,'2026-04-13 08:59:49.119329+00','2026-04-13 08:59:49.119329+00'),
('53ca4b80-b52d-4e89-bd92-04c18c379aea','PRD-KPI05','Production Deployment Report Submit ','Score Of Reporting /Submit report Before Dead Line','general','5','100',true,'2026-04-08 13:37:46.341771+00','2026-07-16 13:20:04.798041+00'),
('b9c6aa38-15da-4ab2-8c34-ec144e0460af','KPI-ABR02','Material Wastage','Consumption Monitoring and Coordination	
','general','15','100',true,'2026-04-13 08:57:34.540339+00','2026-04-13 09:01:56.871492+00'),
('79a3f3d3-8411-4e3d-8777-1d48d069e452','KPI-G3','New Product Marketing','3 Parties minimum Visit For Paddle Working or new products ','Quality','10','100',true,'2026-03-28 05:33:16.813749+00','2026-04-15 08:58:23.252833+00'),
('ac602ce3-8b0c-47b9-a7cd-9bda539b8d6a','SPR-PRD201','Production Target Fancy Final','Plan Given production Target vs Achieved Production','Productivity','20','100',true,'2026-03-28 06:00:36.100556+00','2026-07-10 12:38:06.481175+00'),
('8b0f96d7-0abb-4740-8e10-6e081e6fb3c7','SPR-PRD1-03','MCL Fancy Final','Plan vs Gain MPH % ','	Productivity','15','100',true,'2026-03-28 06:11:15.234171+00','2026-07-10 12:27:45.545827+00'),
('df8a42c7-fd37-414e-8698-267d37f88f73','KPI-Gernal01','Stock Closing Accurate','Har Worng Closing Submit krwane pr 25Point Deduct honge month mai or pora month mai Koi ghalti na hone ki sorat mai 100 points mil jainge','Reporting','15','100',true,'2026-03-28 05:43:32.178447+00','2026-04-08 13:33:59.048828+00'),
('2a266bec-9a03-4d8c-aaf3-7a28ae687e0f','SPR-PRD3-02','NCR','Based On NCR Generated NCR Counts
Score will be deducted On Behalf of NCR each NCR Calculated 1 point & Genration of Any Non-Complaince insident report at QA Department
','Quality','15','100',true,'2026-03-28 06:09:14.611449+00','2026-04-08 13:34:59.46697+00'),
('7703242e-19b2-4cec-a97e-de20f3180955','PRD-KPI06','5S','five-step workplace organization and management method
','general','10','100',true,'2026-04-08 13:38:22.994479+00','2026-04-08 13:38:22.994479+00'),
('89d25612-bd7b-43cb-b845-8ebba0d23b1d','SPR-PRD4-04','Material Loss / Solvent','Solvent Authorize For Production Limit vs Solvent Loss

Pore Month Ka recived Solvent Se Loss % Nikal Kr calculate hoga or 8% Se ziyada hone ki Sorat mai Score Deduct Ho jaiga
','Quality','15','100',true,'2026-03-28 06:12:35.456735+00','2026-04-08 13:39:03.126188+00'),
('2e6f51ba-5d21-4396-9424-6a3a61fc6134','KPI-QA01','Compliance Target','Inspection Target Vs Achivement

80% Se Kam hone pr 0 Score ho jaiga (jis Inspection ka target Per day btaya gaya hai os ka target related Supervisor Se pora krwana hoga or oski Monthly Percentage of Achivement pr Score Calculate hoga or Arsalan ko Inspection Report daily Submit krwani hogi)','QUALITY','20','100',true,'2026-04-08 13:48:49.009479+00','2026-04-08 13:48:49.009479+00'),
('6a7816d5-f32e-4124-8420-81628e7423d9','KPI-QA02','Key process full compliance','Total Of Compliance Vs Total Production Report

95% se se Niche achive hone pr 0 Score mile ga leakage or Rejection jo Niklengi Wo total Production se match honi chahiye ','QUALITY','20','100',true,'2026-04-08 13:49:36.015174+00','2026-04-08 13:49:36.015174+00'),
('3cb35860-5b70-4f43-a6d9-5e84916861b3','KPI-QA03','Production Target Achievement','Local Final Planned production vs actual production.

Diya Hoa Target ka 30 Beg to 25 beg Avg per month pr rakhna hoga Avg 25 se niche hone per 20 Score Kat Jainge','general','10','80',true,'2026-04-08 13:50:25.988399+00','2026-04-08 13:50:25.988399+00'),
('6bc1542a-692a-49f9-832d-2e4e78476ff3','KPI-QA04','Audits Planned and Execution','QC inspection k jo bhi Audit honge Daily Plan Kr k Khud Krne

25 Audits Target Of Month- 20 se Niche hone pr Score 0 Ho jaiga
','QUALITY','20','25',true,'2026-04-08 13:51:21.27521+00','2026-04-08 13:51:21.27521+00'),
('e2753d74-ea00-4ffa-b8d8-289a5bbe2976','KPI-QA06','Process Accuracy Audits','Daily 5 Critical k  Audit krne hai rooz k other Process k 2 Audit

Total of the month Audits 91% Above he hone Chahiye both Processs ki calculation hogi tou he 20 Score mIlenge','QUALIYT','20','91',true,'2026-04-08 13:52:17.829108+00','2026-04-08 13:52:17.829108+00'),
('58c3a10f-3e41-4111-9eed-c15d052a8b1f','KPI-PRD09','MCL(Local + Final Department)','Total of manpower time, Lost  manpower

(10%)MCL Minimum Calculation Level Local And Final Department 10% se kam ka loss ka avg hone pr month mai 15 Score mil jainge 

','Production','10','10',true,'2026-04-08 13:53:06.08607+00','2026-04-08 13:53:06.08607+00'),
('c1e8012b-9d94-47c8-8917-3df0a7b04c6e','KPI-SJ02','Solvent and kerosine(fANCY)','Fancy Department Solvent & kerosine loss Tracking and Save Losses 0%

Raw Material Calculation (RSL) 0% Loss Pr 10 Points Mil jainge','general','10','100',true,'2026-04-13 08:40:21.855699+00','2026-04-13 08:40:21.855699+00'),
('c6a5ccc5-3809-4dc1-939b-46ce79c2bf5e','KPI-SJ03','PLS- Capicity Building','Production Labour And Supervisor ko Requirment k according Treain krna hoga Deadline se pehle
','general','30','100',true,'2026-04-13 08:40:50.083598+00','2026-04-13 08:40:50.083598+00'),
('86ecfdec-019f-44a9-8b01-4eb0414e7d7e','KPI-SJ04','R&D Target','uMAIR Sahab Will ASSIGN','general','10','100',true,'2026-04-13 08:41:15.88611+00','2026-04-13 08:41:15.88611+00'),
('d5d52965-0958-48d2-acc4-321487fc9bb2','KPI-SJ05','Process Optomization(Kaizan Process Perform)',NULL,'general','20','100',true,'2026-04-13 08:41:47.482037+00','2026-04-13 08:41:47.482037+00'),
('a9c9ef44-5e56-4f4a-9a77-3da918dde2b8','KPI-SJ06','Batch Making Audits',NULL,'general','20','100',true,'2026-04-13 08:42:08.932665+00','2026-04-13 08:42:08.932665+00'),
('c702e7e1-1be6-45d0-96fe-c0f50ce52227','KPI-ABR01','Production Planing','Plan Productive Given Vs Achieved	
Month Demand
As per demand And Supply Production Plan And Execution Month Summary Given By Abrar
','general','35','100',true,'2026-04-13 08:56:59.945467+00','2026-04-13 08:56:59.945467+00'),
('267a4757-f332-43f6-82fb-f403a1c7ed36','KPI-ABR03','Dispatch Timly','Dispatch On Time Assign Target	
','general','25','100',true,'2026-04-13 08:58:13.547997+00','2026-04-13 08:58:13.547997+00'),
('114d2fb4-a36e-4bcb-96f8-a3a72eae2edc','KPI-QA-JN01','Leak Collection Fault checking','Posting Of Inspection Daily Basis on Software

Scoring Criteria
98% Accuracy = 0 Score and 99 or above= 20Score

','general','20','100',true,'2026-04-13 09:06:34.956951+00','2026-04-13 09:07:31.408767+00'),
('e62deb96-c685-4b09-878f-6fa657511b40','KPI-QA-JN02','Fancy Ball QA','Fancy Batch Wise Inspection and QA Process as per Production

96% Above =20 ,Marks Bellow then 96% =0 marks
','general','20','100',true,'2026-04-13 09:08:17.8607+00','2026-04-13 09:08:17.8607+00'),
('5cf2ec8c-98f9-418f-9e26-13430032d288','KPI-QA-JN03','Process Accuracy Audits','Daily 5 Critical k  Audit krne hai rooz k other Process k 2 Audit

Total of the month Audits 91% Above he hone Chahiye both Processs ki calculation hogi tou he 20 Score mIlenge','general','20','90',true,'2026-04-13 09:09:25.807157+00','2026-04-13 09:09:25.807157+00'),
('b9d161d3-9a8f-4639-94da-9ba4062727c6','KPI-QA-JN04','OX Ball full QC Reports Submittion','All Process Report Submit On Time As Per Production

Tamam Reports ka Hona Zaroori hai 1 bhi miss hone ki sorat mai 15 Score Deduct Ho jainge
','general','15','100',true,'2026-04-13 09:10:26.876134+00','2026-04-13 09:10:26.876134+00'),
('9af69d4b-6e2d-4a61-a64e-ae4ab6b0b06c','KPI-QA-JN05','CPA Ball Management','Daily Report Submit

Submit Daily Report to management agar reports 80% se kam submit hoi tou 10 Score Kat jainge','general','10','80',true,'2026-04-13 09:11:30.157797+00','2026-04-13 09:11:30.157797+00'),
('93b7f661-cf8e-4ac7-9d37-62e94ecb354d','KPI-QA-JN06','FIFO Audits','Daily Report Submit
bellow then 99% Target hone pr 15 Score Kat jainge
','general','15','99',true,'2026-04-13 09:12:19.207939+00','2026-04-13 09:12:19.207939+00'),
('ab0d186a-d901-4319-9462-23894323b0db','KPI-ABR-01','Production Demond Target','Demand k According Daily Ka Production Complete Honi Chahiye.','general','20','100',true,'2026-04-13 10:28:22.053936+00','2026-04-13 10:28:22.053936+00'),
('a0a20896-8602-4b4c-9690-4e0c7a4e7d1f','KPI-G4','Daily Visits Target','Range 18 to 12minimum daily Visit 12 se niche hone pr score 0 ho jaiga','Productivity','25','100',true,'2026-03-28 05:33:55.606854+00','2026-04-15 08:55:42.923814+00'),
('52a627ff-847a-4836-bef6-34630dbc8a03','KPI-SJ01','Solvent (Jorr)','Jorr Department Solvent & kerosine loss Tracking and Save Losses

Raw Material Calculation (RSL) 5% Loss se Niche Rehne  Pr 10 Points Mil jainge
','general','10','100',true,'2026-04-13 08:39:24.98034+00','2026-06-03 07:31:13.427156+00'),
('5d110db0-79b8-4214-aa41-2dc1e268e1a1','KPI-04','Timely & Accurate Workers Entry(Attendance)','•	✅ Attendance 09:30 AM tak complete aur accurate upload = 100% (Points)
•	❌ 09:31 AM ke baad upload, worker missing, ya kisi bhi type ki attendance error = 0% (Points)','general','5','5',true,'2026-04-13 08:58:56.743265+00','2026-07-16 13:18:41.825799+00'),
('6dbcd861-14d3-44f1-b4ba-6942528f9887','KPI-ABR04','Over Production Threshold',NULL,'general','10','100',true,'2026-04-13 10:37:40.297365+00','2026-04-13 10:37:40.297365+00'),
('8d351dd5-ae8d-497e-968b-044386026590','KPI-ABR06','RAW Material ','RAW material Shortage Frequency ','general','5','100',true,'2026-04-13 10:46:34.39926+00','2026-04-13 10:46:34.39926+00'),
('005e915b-465f-4113-aaa2-177922df47f4','KPI-HR01','Hiring Targets','Number of Target Hiring Complete
Marketing Manager + Packing Machine Operator
','general','10','100',true,'2026-04-14 09:38:19.651138+00','2026-04-14 09:38:19.651138+00'),
('82996b90-3860-460d-86c2-a9d0eaf291fc','KPI-HR02','Labor Productivity','Optimization Labor Productivity and Ask to Sajid and Arsalan and Submit and Highlight Labor Productivity
','general','30','100',true,'2026-04-14 09:39:12.756379+00','2026-04-14 09:39:12.756379+00'),
('08eec906-fa54-446b-8646-8b4ebb14d52b','KPI-HR03','Performance Tracking','HR Module Performance Compilation
Performance Compilation
','general','20','100',true,'2026-04-14 09:40:32.080191+00','2026-04-14 09:40:32.080191+00'),
('d8642390-9fec-4068-b7f1-33d42498e031','KPI-HR04','Office Task','Given Office Task Vs Achieved
Each Pending Task Points Deduct in % Number Achieved Target / Given x 100=Score
','general','10','10',true,'2026-04-14 09:42:38.962931+00','2026-04-14 09:42:38.962931+00'),
('68ac4962-8b79-48e8-adc3-08cf5df5da85','KPI-HR05','Office Adminstration CheckList','Camera / Cleaning / If need Of Maintenance
Camera / Cleaning / If need Of Maintenance Checklist Fill And update with Inspection
','general','10','100',true,'2026-04-14 09:44:15.557506+00','2026-04-14 09:44:15.557506+00'),
('d55db72d-cd0c-4bd0-966e-a9caab05eb4e','KPI-06','Payroll Accuracy','Mistake in Payroll Count
Score Out of 100 Each mistake will Consider as Deduction of 20 Points Each Labor Case.
','general','20','100',true,'2026-04-14 09:45:02.400153+00','2026-04-14 09:45:02.400153+00'),
('b8031e89-7a34-4ce4-9c9a-1db21e7b034a','KPI-ACCOUNTS01','Profit And Loss Audit',NULL,'general','20','100',true,'2026-04-14 09:56:51.60645+00','2026-04-14 09:56:51.60645+00'),
('30f26480-e45a-472c-98bf-f7bba33354ab','KPI-ACCOUNTS02','Balance Sheet',NULL,'general','20','100',true,'2026-04-14 09:57:51.217152+00','2026-04-14 09:57:51.217152+00'),
('895c1516-bc71-47ed-9fef-0c22795c12e2','KPI-ACCOUNTS03','Sales Tax Data Submission',NULL,'general','20','100',true,'2026-04-14 09:58:15.687575+00','2026-04-14 09:58:15.687575+00'),
('929daef2-35e4-4564-917b-d54d099f12ef','KPI-ACCOUNTS04','Daily Main Report',NULL,'general','20','100',true,'2026-04-14 09:58:40.395693+00','2026-04-14 09:58:40.395693+00'),
('52f07c79-c302-49ec-9c75-2e2c4b07774f','KPI-ACCOUNTS05','Payable And Receiveble','Payable And Receivable With Reconciliation Party Wise
','general','20','100',true,'2026-04-14 10:01:40.694178+00','2026-04-14 10:01:40.694178+00'),
('59af3230-68a8-48fa-8d54-25465fa4b1e8','ADMIN-KPI-01','OutDoor Visit Report Submission Daily','Outdoor Report Submission Daily
Assign Task Report Submit By you of previous day Next Morning begor 12pm','general','15','100',true,'2026-04-27 12:47:15.688394+00','2026-04-27 12:47:15.688394+00'),
('f26f078e-5336-4082-aafb-5a8a7e5e7820','ADMIN-KPI-02','5s Audit Inspection','2 Audits PerDay of factory And Check Cleaning Status and WITH Cleaning Check List.

Formula : 100 points / 26Month Days = 3.8 Har day ki inspection report submit krwane pr 3.8 Score Mile ga and report delay submit krwane pr points half ho jainge report same day 6pm tk submit krwani hogi. kesi bhi kisam ki discriprency sabit hone pr 0 ho jaiga os report ka score ','general','25','100',true,'2026-04-27 12:48:05.975839+00','2026-04-27 12:48:33.795513+00'),
('7fed139c-55bd-4b49-b784-51145aa644ca','ADMIN-KPI-03','Timely Attendance Report','Deployment and Attendance report match Timely and submit on time.
Report Submit Target Time 2pm se pehle check kr k submit krwani hogi previous day ki next day 2pm k bad accordingly points deduct honge jo points table apko share kiya gaya hai oske according','general','20','100',true,'2026-04-27 12:49:25.687398+00','2026-04-27 12:49:25.687398+00'),
('3b221917-c1ba-4636-8613-ebeec8eeb75d','ADMIN-KPI-04','Labor Hiring Target','Required Labor Fullfil on time each Day.
Each day 10 point Working day k according Kesi bhi din Labor pori na hone ki sorat mai Production Department ki Complain k through os day k Points deduct ho jainge.','general','10','100',true,'2026-04-27 12:50:24.399978+00','2026-04-27 12:50:24.399978+00'),
('d11f015a-68b6-4944-99a4-6ab25b361656','ADMIN-KPI-05','House Keeping Management','Factory Ground Floor And Outside Cleaning.
Check list k according Factory k Bahir or ground floor and office site ki cleaning ka visit krna or oski check list ko khud se visit kr k verfy kr k HR department mai submit krwani hogi Daily.
','general','20','100',true,'2026-04-27 12:51:38.748703+00','2026-04-27 12:51:38.748703+00'),
('f234d4f7-b897-41c6-ad86-5b57f41b02cc','ADMIN-KPI-06','Cost Effective Purchasing','Score On Purchased iteam Less then Market Rate. Comparative & Review Based Umair Sahab
','general','10','100',true,'2026-04-27 12:52:44.257891+00','2026-04-27 12:52:44.257891+00'),
('904ebbda-b64b-47cb-9fe5-7a221525eb81','ABR-03-JUNE','5S Audit Score','Factory area mein 5S standards maintain karwana
','general','1','100',true,'2026-06-22 13:18:03.505517+00','2026-06-22 13:18:03.505517+00'),
('6bc368a2-c77b-4959-9bdd-681c20523f30','ABR-04-JUNE','Raw Material Stock Maintenance','Raw material stock level maintain karna (Stock-out aur overstock dono avoid)
','general','1','100',true,'2026-06-22 13:19:17.044863+00','2026-06-22 13:19:17.044863+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.performance_monthly_kpis (id,code,name,description,category,weight,max_score,is_active,created_at,updated_at) VALUES
('7eb8e1f0-834a-4246-b983-7d9dde18d134','ABR-05-JUNE','Factory Production Requirment against Sale','Factory Production Requirment against Sale Review Based Month End Sale k requirment k against Production Di ya nhi','general','1','100',true,'2026-06-22 13:21:37.771535+00','2026-06-22 13:21:37.771535+00'),
('2987781e-331b-4457-8c8f-a33f48492cf7','ABR-07-JUNE','3 Physical ladger Match With Signature','Accounts Department Signature On Ladger','general','1','100',true,'2026-06-22 13:27:58.945669+00','2026-06-22 13:27:58.945669+00'),
('1cc65681-b33d-480e-96ac-a1e6b15547f8','ARL-02-JUNE','QA Total Inspections','QA Dashboard Total Inspections
98% + % of checkpoints COMPLATLY Running passed in audit
','general','15','100',true,'2026-06-22 13:31:18.778174+00','2026-06-22 13:31:18.778174+00'),
('ac950a36-5d35-4dca-986b-7815cbfe0ae3','ARL-04-JUNE','Leakage Rate ≤ 1.5%','(Leaked pieces / Total Produced) × 100
','general','20','100',true,'2026-06-22 13:36:09.480273+00','2026-06-22 13:36:09.480273+00'),
('cdc0a28b-a5a8-4b95-9d48-9680ddab04ad','ARL-03-JUNE','Rejection Rate ≤ 2.5%','(Rejected pieces / Total Produced) × 100
≤ 2.5% REJECTION RATE LESS THEN  ≤ 2.5% ANAA CHAHIYE','general','20','100',true,'2026-06-22 13:34:08.383305+00','2026-06-22 13:36:45.771759+00'),
('6d43122f-5c49-4578-bad1-bdd8b8f486e0','ARL-05-JUNE','5S Audit Score',NULL,'general','20','100',true,'2026-06-22 13:38:05.379302+00','2026-06-22 13:38:05.379302+00'),
('7130cd19-f6f1-4984-8762-b7e8644b271a','ABR-02-JUNE','On-Time-Dispatch','Ensure timely dispatch of all orders.','general','1','100',true,'2026-07-04 06:11:43.614595+00','2026-07-04 06:11:43.614595+00'),
('5b6e5413-eaba-4c32-9c24-0c6672599c76','ARL-01-JUNE','WIP ','WIP
','general','20','98',true,'2026-06-22 13:29:48.627385+00','2026-07-09 11:12:27.274329+00'),
('e048ec7a-386e-4f17-96e9-c80848d2a8a6','SPR-MCL-02','MCL Kapra Cutting ','MPH Pland Vs Actual','general','10','100',true,'2026-07-10 12:29:26.88507+00','2026-07-10 12:29:26.88507+00'),
('531e9128-c323-41fb-843d-20a922d82c35','MCL-Jorr','MCL JORR','MPH Plaind Vs Actual','general','20','100',true,'2026-07-10 12:34:35.346853+00','2026-07-10 12:34:35.346853+00'),
('efd7fca8-a0c2-4e68-8476-98c8857193bc','SPR-PRD-Kapra','Production Target Kapra Cutting','Production Target Kapra Cutting','general','10','100',true,'2026-07-10 12:35:41.901689+00','2026-07-10 12:38:52.720582+00'),
('fd2496ef-894d-4c36-b396-024e89e67224','MCL-Local Kapra','MCL Local Kapra',NULL,'general','20','100',true,'2026-07-10 12:52:02.173204+00','2026-07-10 12:52:02.173204+00'),
('7aef9958-42fd-4465-948a-d05e474fad25','MCL-Local Final','MCL-Local Final',NULL,'general','20','100',true,'2026-07-10 12:52:37.266835+00','2026-07-10 12:52:37.266835+00'),
('e76a150e-c638-4ca6-b9cc-7e832948c1e6','SPR-PRD202','Production Target Jorr','Target Achivement %','general','20','100',true,'2026-07-10 13:20:25.734876+00','2026-07-10 13:20:25.734876+00'),
('5957e8fe-2eb8-454c-97c9-ec52dc994b8d','SPR-PRD203','Production Target Local Final','Target Achievement Production % ','general','1','100',true,'2026-07-10 13:29:28.56356+00','2026-07-10 13:29:28.56356+00'),
('de92e8fd-e9b5-4caa-8d83-c4e85720db1d','SPR-PRD204','Production Target Local Kapra','Production Target Achievement % ','general','1','100',true,'2026-07-10 13:30:31.729515+00','2026-07-10 13:30:31.729515+00'),
('3b26cbd8-3ee1-4cad-a28d-3ec4d9914de3','SPR-PRD205','Production Target Press',NULL,'general','1','100',true,'2026-07-10 13:57:53.896978+00','2026-07-10 13:57:53.896978+00'),
('c7a62d27-199b-422d-9386-978f5f772074','MCL-Press','MCL Press',NULL,'general','1','100',true,'2026-07-10 14:02:27.449646+00','2026-07-10 14:02:27.449646+00'),
('9d0f20fe-a786-4b31-8904-d4edb7a43dcb','MCL-Packing','MCL-Packing ',NULL,'general','1','100',true,'2026-07-11 11:11:14.036647+00','2026-07-11 11:11:14.036647+00'),
('6293cb1e-a5a6-4290-9472-66d4975c1631','KPI-G1-01','Daily Sale VM72  Target ','Daily Minimum 5 Cotton Book krne hai VM72 KE','Productivity','20','100',true,'2026-03-28 05:36:27.142972+00','2026-08-20 11:21:10.620852+00'),
('5ec20f17-6677-4255-9209-e6a65bbf90b1','KPI-G1-02','Daily Sale OTHER variants Target','Spinner/Dolphin/CANCON EXTRA/EDGE','general','20','100',true,'2026-08-20 11:17:31.293613+00','2026-08-20 11:21:19.351884+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.performance_review_cycles (id,name,description,start_date,end_date,status,created_by,created_at,updated_at) VALUES
('c27ec238-ef52-43a5-b11b-a3418f103117','mothly review',NULL,'2026-01-01','2026-01-31','active',NULL,'2026-01-10 20:17:19.679784+00','2026-01-10 20:17:19.679784+00'),
('f36d9c6b-ddf0-4870-9c96-e916003fffea','Weekly Review',NULL,'2026-02-23','2026-02-28','active',NULL,'2026-02-27 12:26:31.509625+00','2026-02-27 12:26:31.509625+00')
ON CONFLICT (id) DO NOTHING;
