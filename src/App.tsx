import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RoleBasedRedirect } from "@/components/RoleBasedRedirect";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import ComingSoon from "./pages/ComingSoon";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";

// Settings pages
import UsersPage from "./pages/settings/UsersPage";
import RolesPage from "./pages/settings/RolesPage";

// Production pages
import ProductionDashboard from "./pages/production/ProductionDashboard";
import DailyEntryPage from "./pages/production/DailyEntryPage";
import WIPTrackingPage from "./pages/production/WIPTrackingPage";
import ProductionReportsPage from "./pages/production/ProductionReportsPage";
import ProductionOrdersPage from "./pages/production/ProductionOrdersPage";
import ProductionOrderDashboard from "./pages/production/ProductionOrderDashboard";
import ProductionTargetDashboard from "./pages/production/ProductionTargetDashboard";
import ProductionEntryListPage from "./pages/production/ProductionEntryListPage";
import MPHMasterPage from "./pages/production/MPHMasterPage";
import ProductionCoordinatorPage from "./pages/production/ProductionCoordinatorPage";
import QualityCoordinatorPage from "./pages/qa/QualityCoordinatorPage";
import WIPSequencePage from "./pages/production/WIPSequencePage";
import WIPLedgerPage from "./pages/production/WIPLedgerPage";
import WIPReconciliationPage from "./pages/production/WIPReconciliationPage";
import AuditLogPage from "./pages/settings/AuditLogPage";
import SystemAlertsPage from "./pages/settings/SystemAlertsPage";

// QA pages
import QADashboard from "./pages/qa/QADashboard";
import ProcessMasterPage from "./pages/qa/ProcessMasterPage";
import InspectionsPage from "./pages/qa/InspectionsPage";
import OperatorInspectionPage from "./pages/qa/OperatorInspectionPage";
import NCRCAPAPage from "./pages/qa/NCRCAPAPage";
import CAPADashboardPage from "./pages/qa/CAPADashboardPage";
import ProcessInspectionsDashboard from "./pages/qa/ProcessInspectionsDashboard";
import QAReleasePage from "./pages/qa/QAReleasePage";
import DailyQualityPlanPage from "./pages/qa/DailyQualityPlanPage";
import QAInspectionTargetDashboard from "./pages/qa/QAInspectionTargetDashboard";
import ProcessInstructionsPage from "./pages/qa/ProcessInstructionsPage";
import InstructionAcknowledgementPage from "./pages/qa/InstructionAcknowledgementPage";
import ProcessStandardsPage from "./pages/qa/ProcessStandardsPage";
import FloorInspectionDisplayPage from "./pages/qa/FloorInspectionDisplayPage";

// Maintenance pages
import MaintenanceDashboard from "./pages/maintenance/MaintenanceDashboard";
import WorkOrdersPage from "./pages/maintenance/WorkOrdersPage";
import BreakdownLogsPage from "./pages/maintenance/BreakdownLogsPage";
import PMSchedulePage from "./pages/maintenance/PMSchedulePage";
import PMDashboard from "./pages/maintenance/PMDashboard";
import SparePartsPage from "./pages/maintenance/SparePartsPage";
import SparePartIssuesPage from "./pages/maintenance/SparePartIssuesPage";
import SparePartsDashboard from "./pages/maintenance/SparePartsDashboard";
import MachineSpareConsumptionPage from "./pages/maintenance/MachineSpareConsumptionPage";
import DevTasksPage from "./pages/maintenance/DevTasksPage";
import MachinesPage from "./pages/maintenance/MachinesPage";

// Performance pages
import PerformanceDashboard from "./pages/performance/PerformanceDashboard";
import MonthlyPerformanceDashboard from "./pages/performance/MonthlyPerformanceDashboard";
import KPILibraryPage from "./pages/performance/KPILibraryPage";
import GoalAssignmentsPage from "./pages/performance/GoalAssignmentsPage";
import ReviewsPage from "./pages/performance/ReviewsPage";
import EmployeeScoreCardsPage from "./pages/performance/EmployeeScoreCardsPage";
import MonthlyKPIMasterPage from "./pages/performance/MonthlyKPIMasterPage";
import MonthlyGoalAssignmentPage from "./pages/performance/MonthlyGoalAssignmentPage";
import MonthlyScoreEntryPage from "./pages/performance/MonthlyScoreEntryPage";
import DailyKPITrackingPage from "./pages/performance/DailyKPITrackingPage";
import DailyProgressAnalysisPage from "./pages/performance/DailyProgressAnalysisPage";
import PerformanceReportsPage from "./pages/performance/PerformanceReportsPage";

// HR pages
import HRDashboard from "./pages/hr/HRDashboard";
import AttendancePage from "./pages/hr/AttendancePage";
import LeaveRequestsPage from "./pages/hr/LeaveRequestsPage";
import RecruitmentPage from "./pages/hr/RecruitmentPage";
import LoansPage from "./pages/hr/LoansPage";
import EmployeesPage from "./pages/hr/EmployeesPage";
import SalaryReportPage from "./pages/hr/SalaryReportPage";
import AttendanceSheetPage from "./pages/hr/AttendanceSheetPage";
import PublicHolidaysPage from "./pages/hr/PublicHolidaysPage";
import HRPunctualityAnalyticsPage from "./pages/hr/HRPunctualityAnalyticsPage";

// Sales pages
import SalesDashboard from "./pages/sales/SalesDashboard";
import CustomersPage from "./pages/sales/CustomersPage";
import CustomerLogosPage from "./pages/sales/CustomerLogosPage";
import QuotationsPage from "./pages/sales/QuotationsPage";
import SalesOrdersPage from "./pages/sales/SalesOrdersPage";
import CustomerVisitDashboard from "./pages/sales/CustomerVisitDashboard";
import DispatchPage from "./pages/sales/DispatchPage";
import COGSPage from "./pages/sales/COGSPage";

// Domestic Sales pages
import DomesticDashboard from "./pages/domestic/DomesticDashboard";
import DomesticCustomersPage from "./pages/domestic/DomesticCustomersPage";
import DomesticOrdersPage from "./pages/domestic/DomesticOrdersPage";
import DomesticDispatchPage from "./pages/domestic/DomesticDispatchPage";
import DomesticDispatchDashboard from "./pages/domestic/DomesticDispatchDashboard";
import DomesticPendingDispatchPage from "./pages/domestic/DomesticPendingDispatchPage";
import DomesticDispatchAcknowledgementPage from "./pages/domestic/DomesticDispatchAcknowledgementPage";
import DomesticItemOpeningPage from "./pages/domestic/DomesticItemOpeningPage";
import DomesticNewItemPage from "./pages/domestic/DomesticNewItemPage";
import DomesticOrderStatusPage from "./pages/domestic/DomesticOrderStatusPage";
import DomesticDeadlineRequestsPage from "./pages/domestic/DomesticDeadlineRequestsPage";
import DomesticInvoicesPage from "./pages/domestic/DomesticInvoicesPage";
import PackingTypesPage from "./pages/sales/PackingTypesPage";

// Export Sales pages
import ExportDashboard from "./pages/export/ExportDashboard";
import ExportCustomersPage from "./pages/export/ExportCustomersPage";
import ExportOrdersPage from "./pages/export/ExportOrdersPage";
import ExportDispatchPage from "./pages/export/ExportDispatchPage";

// Master Data pages
import DepartmentsPage from "./pages/master/DepartmentsPage";
import GradesPage from "./pages/master/GradesPage";
import ProductsPage from "./pages/master/ProductsPage";
import UnitsPage from "./pages/master/UnitsPage";
import ReasonsPage from "./pages/master/ReasonsPage";
import ItemsPage from "./pages/master/ItemsPage";

// Purchase pages
import PurchaseDashboard from "./pages/purchase/PurchaseDashboard";
import SuppliersPage from "./pages/purchase/SuppliersPage";
import PurchaseOrdersPage from "./pages/purchase/PurchaseOrdersPage";
import GoodsReceiptPage from "./pages/purchase/GoodsReceiptPage";
import PurchaseInvoicesPage from "./pages/purchase/PurchaseInvoicesPage";

// Inventory pages
import InventoryDashboard from "./pages/inventory/InventoryDashboard";
import InventoryStockPage from "./pages/inventory/InventoryStockPage";
import StockMovementsPage from "./pages/inventory/StockMovementsPage";
import InventoryLedgerPage from "./pages/inventory/InventoryLedgerPage";
import WIPInventoryPage from "./pages/inventory/WIPInventoryPage";
import InventoryLocationsPage from "./pages/inventory/InventoryLocationsPage";

// Floor Inventory pages
import FloorInventoryDashboard from "./pages/floor-inventory/FloorInventoryDashboard";
import FloorInventoryItemsPage from "./pages/floor-inventory/FloorInventoryItemsPage";
import FloorInventoryStockPage from "./pages/floor-inventory/FloorInventoryStockPage";
import FloorInventoryMovementsPage from "./pages/floor-inventory/FloorInventoryMovementsPage";
import FloorInventoryProductionPage from "./pages/floor-inventory/FloorInventoryProductionPage";
import FloorInventoryLedgerPage from "./pages/floor-inventory/FloorInventoryLedgerPage";
import FloorInventoryLocationsPage from "./pages/floor-inventory/FloorInventoryLocationsPage";

// Production Planning pages
import ProductionPlanningDashboard from "./pages/planning/ProductionPlanningDashboard";
import CapacityMasterPage from "./pages/planning/CapacityMasterPage";
import WeeklyPlanningPage from "./pages/planning/WeeklyPlanningPage";
import PlanningItemMasterPage from "./pages/planning/PlanningItemMasterPage";
import DailyStockClosingPage from "./pages/planning/DailyStockClosingPage";
import DailyClosingDashboard from "./pages/planning/DailyClosingDashboard";
import SkilledLabourPlanningPage from "./pages/planning/SkilledLabourPlanningPage";

// Labour Productivity pages
import LabourProductivityDashboard from "./pages/labour/LabourProductivityDashboard";
import LabourProductivityEntryPage from "./pages/labour/LabourProductivityEntryPage";
import LabourEmployeesPage from "./pages/labour/LabourEmployeesPage";
import LabourCategoriesPage from "./pages/labour/LabourCategoriesPage";
import LabourAttendancePage from "./pages/labour/LabourAttendancePage";
import LabourSalaryPage from "./pages/labour/LabourSalaryPage";
import ProcessProductivityDashboard from "./pages/labour/ProcessProductivityDashboard";
import CategoryProductivityDashboard from "./pages/labour/CategoryProductivityDashboard";
import LabourPublicHolidaysPage from "./pages/labour/LabourPublicHolidaysPage";
import LabourProcessTargetsPage from "./pages/labour/LabourProcessTargetsPage";
import IndividualPerformanceDashboard from "./pages/labour/IndividualPerformanceDashboard";
import LabourMPHManagementPage from "./pages/labour/LabourMPHManagementPage";
import LabourTodaysTargetPage from "./pages/labour/LabourTodaysTargetPage";
import LabourDeploymentAnalysisPage from "./pages/labour/LabourDeploymentAnalysisPage";
import LabourProductivityEditRequestsPage from "./pages/labour/LabourProductivityEditRequestsPage";

// Fixed Assets pages
import FixedAssetsDashboard from "./pages/fixed-assets/FixedAssetsDashboard";
import FixedAssetsListPage from "./pages/fixed-assets/FixedAssetsListPage";
import AssetValuationsPage from "./pages/fixed-assets/AssetValuationsPage";
import AssetDisposalPage from "./pages/fixed-assets/AssetDisposalPage";
import FixedAssetCategoriesPage from "./pages/fixed-assets/FixedAssetCategoriesPage";
import AssetReconciliationPage from "./pages/fixed-assets/AssetReconciliationPage";

// Expense Management pages
import ExpenseDashboard from "./pages/expenses/ExpenseDashboard";
import PettyCashPage from "./pages/expenses/PettyCashPage";
import GeneralExpensesPage from "./pages/expenses/GeneralExpensesPage";
import UtilityBillsPage from "./pages/expenses/UtilityBillsPage";
import ExpenseBudgetsPage from "./pages/expenses/ExpenseBudgetsPage";
import ExpenseMasterPage from "./pages/expenses/ExpenseMasterPage";
import OperatingExpensesAnalysisPage from "./pages/expenses/OperatingExpensesAnalysisPage";

// Material Consumption pages
import ConsumptionDashboard from "./pages/consumption/ConsumptionDashboard";
import ConsumptionProductionDashboard from "./pages/consumption/ConsumptionProductionDashboard";
import ConsumptionEfficiencyDashboard from "./pages/consumption/ConsumptionEfficiencyDashboard";
import RawMaterialsPage from "./pages/consumption/RawMaterialsPage";
import ConsumptionProductsPage from "./pages/consumption/ConsumptionProductsPage";
import ConsumptionBOMPage from "./pages/consumption/ConsumptionBOMPage";
import StockClosingPage from "./pages/consumption/StockClosingPage";
import StockClosingViewPage from "./pages/consumption/StockClosingViewPage";
import ConsumptionStockClosingDashboard from "./pages/consumption/ConsumptionStockClosingDashboard";
import ProductionEntryPage from "./pages/consumption/ProductionEntryPage";
import ConsumptionAnalysisPage from "./pages/consumption/ConsumptionAnalysisPage";
import MonthlyReceiptViewPage from "./pages/consumption/MonthlyReceiptViewPage";
import ConsumptionCategoriesPage from "./pages/consumption/ConsumptionCategoriesPage";
import ConsumptionUsageReportPage from "./pages/consumption/ConsumptionUsageReportPage";

// 5S Module pages
import FiveSDashboard from "./pages/five-s/FiveSDashboard";
import FiveSAuditsPage from "./pages/five-s/FiveSAuditsPage";
import FiveSActionItemsPage from "./pages/five-s/FiveSActionItemsPage";
import FiveSCheckpointsPage from "./pages/five-s/FiveSCheckpointsPage";
import FiveSDepartmentsPage from "./pages/five-s/FiveSDepartmentsPage";

// Finance Reports pages

// Six Sigma pages
import SixSigmaDashboard from "./pages/six-sigma/SixSigmaDashboard";
import SixSigmaProjectsPage from "./pages/six-sigma/SixSigmaProjectsPage";
import SixSigmaToolsPage from "./pages/six-sigma/SixSigmaToolsPage";
import SixSigmaMetricsPage from "./pages/six-sigma/SixSigmaMetricsPage";

// Online Sales pages
import OnlineSalesDashboard from "./pages/online-sales/OnlineSalesDashboard";
import OnlinePlatformMasterPage from "./pages/online-sales/OnlinePlatformMasterPage";
import OnlineOrdersPage from "./pages/online-sales/OnlineOrdersPage";

import OnlineReturnsPage from "./pages/online-sales/OnlineReturnsPage";

import OnlineItemMasterPage from "./pages/online-sales/OnlineItemMasterPage";

// Project Management pages
import ProjectsDashboard from "./pages/projects/ProjectsDashboard";
import ProjectsListPage from "./pages/projects/ProjectsListPage";
import ProjectKanbanPage from "./pages/projects/ProjectKanbanPage";
import ProjectDetailPage from "./pages/projects/ProjectDetailPage";

// R&D pages
import RDDashboard from "./pages/rd/RDDashboard";
import RDProjectsPage from "./pages/rd/RDProjectsPage";
import RDProjectDetailPage from "./pages/rd/RDProjectDetailPage";
import RDExperimentsPage from "./pages/rd/RDExperimentsPage";

// Hourly Production pages
import HourlyProductionDashboard from "./pages/hourly-production/HourlyProductionDashboard";
import HourlyProductionEntryPage from "./pages/hourly-production/HourlyProductionEntryPage";
import HourlyProductionReportsPage from "./pages/hourly-production/HourlyProductionReportsPage";
import HourlyProductionFloorDisplay from "./pages/hourly-production/HourlyProductionFloorDisplay";
import HourlyProductionProcessMasterPage from "./pages/hourly-production/HourlyProductionProcessMasterPage";

// Machine Monitor pages
import MachineMonitorDisplay from "./pages/machine-monitor/MachineMonitorDisplay";
import MachineMonitorMachinesPage from "./pages/machine-monitor/MachineMonitorMachinesPage";
import MachineStatusEntryPage from "./pages/machine-monitor/MachineStatusEntryPage";
import MachineQRScanPage from "./pages/machine-monitor/MachineQRScanPage";

// Accounting (Standalone) pages
import AccountingDashboard from "./pages/accounting/AccountingDashboard";
import AccountingCoAPage from "./pages/accounting/AccountingCoAPage";
import AccountingPartiesPage from "./pages/accounting/AccountingPartiesPage";
import AccountingVouchersPage from "./pages/accounting/AccountingVouchersPage";
import NewVoucherPage from "./pages/accounting/NewVoucherPage";
import DayBookPage from "./pages/accounting/DayBookPage";
import CashBookPage from "./pages/accounting/CashBookPage";
import BankBookPage from "./pages/accounting/BankBookPage";
import GeneralLedgerPage from "./pages/accounting/GeneralLedgerPage";
import PartyLedgerPage from "./pages/accounting/PartyLedgerPage";
import ReceivablesPayablesReportPage from "./pages/accounting/ReceivablesPayablesReportPage";
import AccountingTrialBalancePage from "./pages/accounting/TrialBalancePage";
import AccountingProfitLossPage from "./pages/accounting/ProfitLossPage";
import AccountingBalanceSheetPage from "./pages/accounting/BalanceSheetPage";
import DefaultAccountsPage from "./pages/accounting/DefaultAccountsPage";
import SalesReconciliationPage from "./pages/accounting/SalesReconciliationPage";
import AccountingSalesReportPage from "./pages/accounting/SalesReportPage";
import AccountingSalesAnalysisPage from "./pages/accounting/SalesAnalysisPage";
import AccountingPurchaseAnalysisPage from "./pages/accounting/PurchaseAnalysisPage";
import ProductionCostRecognitionPage from "./pages/accounting/ProductionCostRecognitionPage";
import ProductionReconciliationPage from "./pages/accounting/ProductionReconciliationPage";
import PurchaseReconciliationPage from "./pages/accounting/PurchaseReconciliationPage";
import ProductionOutputRecognitionPage from "./pages/accounting/ProductionOutputRecognitionPage";
import CustomerReceiptsPage from "./pages/accounting/CustomerReceiptsPage";
import SupplierPaymentsPage from "./pages/accounting/SupplierPaymentsPage";
import SalesReturnPage from "./pages/accounting/SalesReturnPage";
import PurchaseReturnPage from "./pages/accounting/PurchaseReturnPage";
import SalesReturnsPage from "./pages/sales/SalesReturnsPage";
import CustomerPricingPage from "./pages/sales/CustomerPricingPage";
import PurchaseReturnsPage from "./pages/purchase/PurchaseReturnsPage";
import PeriodClosePage from "./pages/accounting/PeriodClosePage";
import PeriodicCOGSPage from "./pages/accounting/PeriodicCOGSPage";
import AccountingAuditLogPage from "./pages/accounting/AuditLogPage";
import AccountingSettingsPage from "./pages/accounting/AccountingSettingsPage";

// CRM pages
import CRMDashboard from "./pages/crm/CRMDashboard";
import CRMLeadsPage from "./pages/crm/CRMLeadsPage";
import CRMContactsPage from "./pages/crm/CRMContactsPage";
import CRMDealsPipelinePage from "./pages/crm/CRMDealsPipelinePage";
import CRMActivitiesPage from "./pages/crm/CRMActivitiesPage";
import CRMContentPage from "./pages/crm/CRMContentPage";
// CRM v1 additions
import CRMProductBrandPage from "./pages/crm/CRMProductBrandPage";
import CRMDailyClosingPage from "./pages/crm/CRMDailyClosingPage";
import CRMMarketingKPIsPage from "./pages/crm/CRMMarketingKPIsPage";
import CRMReactivationPage from "./pages/crm/CRMReactivationPage";
import AeroCourtsKanbanPage from "./pages/crm/aero/AeroCourtsKanbanPage";
import AeroCourtsInsightsPage from "./pages/crm/aero/AeroCourtsInsightsPage";
import CRMSampleItemsMasterPage from "./pages/crm/CRMSampleItemsMasterPage";
import CRMSampleInventoryPage from "./pages/crm/CRMSampleInventoryPage";
import CRMSampleRequestsPage from "./pages/crm/CRMSampleRequestsPage";
// Marketing pages
import MarketingDashboard from "./pages/marketing/MarketingDashboard";
import MarketingCampaignsPage from "./pages/marketing/MarketingCampaignsPage";
import MarketingDeliverablesKanbanPage from "./pages/marketing/MarketingDeliverablesKanbanPage";
import MarketingGanttPage from "./pages/marketing/MarketingGanttPage";
import MarketingCalendarPage from "./pages/marketing/MarketingCalendarPage";
import MarketingEventsPage from "./pages/marketing/MarketingEventsPage";
import MarketingMeetingsPage from "./pages/marketing/MarketingMeetingsPage";
import MarketingMastersPage from "./pages/marketing/MarketingMastersPage";
// Hourly Production v1 additions
import HourlyProductionAnalysisPage from "./pages/hourly-production/HourlyProductionAnalysisPage";
import HourlyProductionLiveOverviewPage from "./pages/hourly-production/HourlyProductionLiveOverviewPage";
import HourlyProductionLossEntryPage from "./pages/hourly-production/HourlyProductionLossEntryPage";
import HourlyProductionLossLogsPage from "./pages/hourly-production/HourlyProductionLossLogsPage";
import HPMaterialMasterPage from "./pages/hourly-production/HPMaterialMasterPage";
import HPMaterialIssuancePage from "./pages/hourly-production/HPMaterialIssuancePage";
import HPMaterialConsumptionPage from "./pages/hourly-production/HPMaterialConsumptionPage";
import HPMaterialAnalysisPage from "./pages/hourly-production/HPMaterialAnalysisPage";
// Machine Monitor v1 additions
import MachineMonitorBreakdownLogsPage from "./pages/machine-monitor/MachineMonitorBreakdownLogsPage";
import MachineMonitorPerformanceLogsPage from "./pages/machine-monitor/MachineMonitorPerformanceLogsPage";
// Labour v1 additions
import MissingProductivityEntriesPage from "./pages/labour/MissingProductivityEntriesPage";
// Master v1 additions
import HourlyLossReasonsPage from "./pages/master/HourlyLossReasonsPage";
// Online Sales v1 additions
import OnlineSalesAnalysisPage from "./pages/online-sales/OnlineSalesAnalysisPage";
// Planning v1 additions
import JobOrdersPage from "./pages/planning/JobOrdersPage";
import JobOrderDepartmentsPage from "./pages/planning/JobOrderDepartmentsPage";
import StoreManagementPage from "./pages/planning/StoreManagementPage";
// Sales fuel/geo + timesheets (v1 top-ups)
import SalesFuelVehiclesPage from "./pages/sales/SalesFuelVehiclesPage";
import SalesFuelTripsPage from "./pages/sales/SalesFuelTripsPage";
import SalesFuelPricesPage from "./pages/sales/SalesFuelPricesPage";
import SalesFuelPayoutsPage from "./pages/sales/SalesFuelPayoutsPage";
import AreasMasterPage from "./pages/sales/AreasMasterPage";
import CitiesMasterPage from "./pages/sales/CitiesMasterPage";
import CustomerCategoriesMasterPage from "./pages/sales/CustomerCategoriesMasterPage";
import TimeSheetPage from "./pages/hr/TimeSheetPage";
import LabourTimeSheetPage from "./pages/labour/LabourTimeSheetPage";
// Rejections & Wastage pages
import RejectionsWastagesDashboard from "./pages/rejections/RejectionsWastagesDashboard";
import RejectionsWastageEntryPage from "./pages/rejections/RejectionsWastageEntryPage";
import ReworkTrackingPage from "./pages/rejections/ReworkTrackingPage";
import RejectionWastageReasonsPage from "./pages/rejections/RejectionWastageReasonsPage";
import RWUnitsMasterPage from "./pages/rejections/RWUnitsMasterPage";
import RWDispositionsMasterPage from "./pages/rejections/RWDispositionsMasterPage";
import RWMaterialsMasterPage from "./pages/rejections/RWMaterialsMasterPage";
import RejectionsAnalyticsPage from "./pages/rejections/RejectionsAnalyticsPage";
// WIP Management pages
import WIPMonitorDashboard from "./pages/wip/WIPMonitorDashboard";
import WIPStockEntryPage from "./pages/wip/WIPStockEntryPage";
import WIPStagesPage from "./pages/wip/WIPStagesPage";
import WIPThresholdsPage from "./pages/wip/WIPThresholdsPage";
import WIPFlowAnalysisPage from "./pages/wip/WIPFlowAnalysisPage";
// Distributor Order Management module
import DistributorDashboard from "./pages/distributor/DistributorDashboard";
import DistributorsMasterPage from "./pages/distributor/DistributorsMasterPage";
import DistributorCustomersPage from "./pages/distributor/DistributorCustomersPage";
import DistributorUsersPage from "./pages/distributor/DistributorUsersPage";
import DistributorProductsPage from "./pages/distributor/DistributorProductsPage";
import DistributorOrdersPage from "./pages/distributor/DistributorOrdersPage";
import DistributorOrderAnalysisPage from "./pages/distributor/DistributorOrderAnalysisPage";
import DistributorApprovalsPage from "./pages/distributor/DistributorApprovalsPage";
import DistributorDispatchPage from "./pages/distributor/DistributorDispatchPage";

const queryClient = new QueryClient();

// Wraps the routed content so a render error shows a recoverable message
// instead of a blank white screen, and clears itself when the route changes.
const RoutedContent = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <PWAUpdatePrompt />
        <BrowserRouter>
          <RoutedContent>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Role-based redirect on root */}
            <Route path="/" element={<RoleBasedRedirect />} />
            {/* Main dashboard for super_admin only */}
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute requiredRole="super_admin">
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            
            {/* Settings Routes */}
            <Route 
              path="/settings/users" 
              element={
                <ProtectedRoute requiredRole="super_admin">
                  <UsersPage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/settings/roles" 
              element={
                <ProtectedRoute>
                  <RolesPage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/settings/audit-log" 
              element={
                <ProtectedRoute>
                  <AuditLogPage />
                </ProtectedRoute>
              } 
            />

            <Route 
              path="/settings/alerts" 
              element={
                <ProtectedRoute>
                  <SystemAlertsPage />
                </ProtectedRoute>
              } 
            />

            {/* Production Routes */}
            <Route path="/production/dashboard" element={<ProtectedRoute><ProductionDashboard /></ProtectedRoute>} />
            <Route path="/production/orders" element={<ProtectedRoute><ProductionOrdersPage /></ProtectedRoute>} />
            <Route path="/production/order-dashboard" element={<ProtectedRoute><ProductionOrderDashboard /></ProtectedRoute>} />
            <Route path="/production/daily-entry" element={<ProtectedRoute><DailyEntryPage /></ProtectedRoute>} />
            <Route path="/production/wip" element={<ProtectedRoute><WIPTrackingPage /></ProtectedRoute>} />
            <Route path="/production/reports" element={<ProtectedRoute><ProductionReportsPage /></ProtectedRoute>} />
            <Route path="/production/target-dashboard" element={<ProtectedRoute><ProductionTargetDashboard /></ProtectedRoute>} />
            <Route path="/production/entry-list" element={<ProtectedRoute><ProductionEntryListPage /></ProtectedRoute>} />
            <Route path="/production/mph-master" element={<ProtectedRoute><MPHMasterPage /></ProtectedRoute>} />
            <Route path="/production/coordinator" element={<ProtectedRoute><ProductionCoordinatorPage /></ProtectedRoute>} />
            <Route path="/production/wip-sequence" element={<ProtectedRoute><WIPSequencePage /></ProtectedRoute>} />
            <Route path="/production/wip-ledger" element={<ProtectedRoute><WIPLedgerPage /></ProtectedRoute>} />
            <Route path="/production/wip-reconciliation" element={<ProtectedRoute><WIPReconciliationPage /></ProtectedRoute>} />
            <Route path="/production/*" element={<ProtectedRoute><ComingSoon title="Production Module" /></ProtectedRoute>} />

            {/* QA Floor Display - Public route for production floor devices */}
            <Route path="/qa/floor-display" element={<FloorInspectionDisplayPage />} />
            {/* QA Routes */}
            <Route path="/qa/dashboard" element={<ProtectedRoute><QADashboard /></ProtectedRoute>} />
            <Route path="/qa/processes" element={<ProtectedRoute><ProcessMasterPage /></ProtectedRoute>} />
            <Route path="/qa/inspections" element={<ProtectedRoute><InspectionsPage /></ProtectedRoute>} />
            <Route path="/qa/operator-inspection" element={<ProtectedRoute><OperatorInspectionPage /></ProtectedRoute>} />
            <Route path="/qa/process-inspections" element={<ProtectedRoute><ProcessInspectionsDashboard /></ProtectedRoute>} />
            <Route path="/qa/daily-plan" element={<ProtectedRoute><DailyQualityPlanPage /></ProtectedRoute>} />
            <Route path="/qa/inspection-targets" element={<ProtectedRoute><QAInspectionTargetDashboard /></ProtectedRoute>} />
            <Route path="/qa/ncr-capa" element={<ProtectedRoute><NCRCAPAPage /></ProtectedRoute>} />
            <Route path="/qa/capa-dashboard" element={<ProtectedRoute><CAPADashboardPage /></ProtectedRoute>} />
            <Route path="/qa/release" element={<ProtectedRoute><QAReleasePage /></ProtectedRoute>} />
            <Route path="/qa/process-instructions" element={<ProtectedRoute><ProcessInstructionsPage /></ProtectedRoute>} />
            <Route path="/qa/instruction-acknowledgement" element={<ProtectedRoute><InstructionAcknowledgementPage /></ProtectedRoute>} />
            <Route path="/qa/process-standards" element={<ProtectedRoute requiredRole="super_admin"><ProcessStandardsPage /></ProtectedRoute>} />
            <Route path="/qa/quality-coordinator" element={<ProtectedRoute><QualityCoordinatorPage /></ProtectedRoute>} />
            <Route path="/qa/*" element={<ProtectedRoute><ComingSoon title="Quality Assurance Module" /></ProtectedRoute>} />

            {/* HR Routes */}
            <Route path="/hr/dashboard" element={<ProtectedRoute><HRDashboard /></ProtectedRoute>} />
            <Route path="/hr/employees" element={<ProtectedRoute><EmployeesPage /></ProtectedRoute>} />
            <Route path="/hr/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
            <Route path="/hr/attendance-sheet" element={<ProtectedRoute><AttendanceSheetPage /></ProtectedRoute>} />
            <Route path="/hr/leaves" element={<ProtectedRoute><LeaveRequestsPage /></ProtectedRoute>} />
            <Route path="/hr/recruitment" element={<ProtectedRoute><RecruitmentPage /></ProtectedRoute>} />
            <Route path="/hr/loans" element={<ProtectedRoute><LoansPage /></ProtectedRoute>} />
            <Route path="/hr/salary-report" element={<ProtectedRoute><SalaryReportPage /></ProtectedRoute>} />
            <Route path="/hr/public-holidays" element={<ProtectedRoute requiredRole="super_admin"><PublicHolidaysPage /></ProtectedRoute>} />
            <Route path="/hr/punctuality-analytics" element={<ProtectedRoute><HRPunctualityAnalyticsPage /></ProtectedRoute>} />
            <Route path="/hr/time-sheet" element={<ProtectedRoute><TimeSheetPage /></ProtectedRoute>} />
            <Route path="/hr/*" element={<ProtectedRoute><ComingSoon title="HR Module" /></ProtectedRoute>} />

            {/* Performance Routes */}
            <Route path="/performance/dashboard" element={<ProtectedRoute><PerformanceDashboard /></ProtectedRoute>} />
            <Route path="/performance/kpi" element={<ProtectedRoute><KPILibraryPage /></ProtectedRoute>} />
            <Route path="/performance/assignments" element={<ProtectedRoute><GoalAssignmentsPage /></ProtectedRoute>} />
            <Route path="/performance/reviews" element={<ProtectedRoute><ReviewsPage /></ProtectedRoute>} />
            <Route path="/performance/score-cards" element={<ProtectedRoute><EmployeeScoreCardsPage /></ProtectedRoute>} />
            <Route path="/performance/monthly-kpis" element={<ProtectedRoute><MonthlyKPIMasterPage /></ProtectedRoute>} />
            <Route path="/performance/monthly-goals" element={<ProtectedRoute><MonthlyGoalAssignmentPage /></ProtectedRoute>} />
            <Route path="/performance/monthly-scores" element={<ProtectedRoute><MonthlyScoreEntryPage /></ProtectedRoute>} />
            <Route path="/performance/daily-tracking" element={<ProtectedRoute><DailyKPITrackingPage /></ProtectedRoute>} />
            <Route path="/performance/daily-progress" element={<ProtectedRoute><DailyProgressAnalysisPage /></ProtectedRoute>} />
            <Route path="/performance/reports" element={<ProtectedRoute><PerformanceReportsPage /></ProtectedRoute>} />
            <Route path="/performance/monthly-dashboard" element={<ProtectedRoute><MonthlyPerformanceDashboard /></ProtectedRoute>} />
            <Route path="/performance/*" element={<ProtectedRoute><ComingSoon title="Performance Module" /></ProtectedRoute>} />

            {/* Maintenance Routes */}
            <Route path="/maintenance/assets" element={<ProtectedRoute><MachinesPage /></ProtectedRoute>} />
            <Route path="/maintenance/dashboard" element={<ProtectedRoute><MaintenanceDashboard /></ProtectedRoute>} />
            <Route path="/maintenance/tickets" element={<ProtectedRoute><WorkOrdersPage /></ProtectedRoute>} />
            <Route path="/maintenance/breakdowns" element={<ProtectedRoute><BreakdownLogsPage /></ProtectedRoute>} />
            <Route path="/maintenance/pm-dashboard" element={<ProtectedRoute><PMDashboard /></ProtectedRoute>} />
            <Route path="/maintenance/pm-schedule" element={<ProtectedRoute><PMSchedulePage /></ProtectedRoute>} />
            <Route path="/maintenance/spare-parts" element={<ProtectedRoute><SparePartsPage /></ProtectedRoute>} />
            <Route path="/maintenance/spare-part-issues" element={<ProtectedRoute><SparePartIssuesPage /></ProtectedRoute>} />
            <Route path="/maintenance/spare-dashboard" element={<ProtectedRoute><SparePartsDashboard /></ProtectedRoute>} />
            <Route path="/maintenance/spare-consumption" element={<ProtectedRoute><MachineSpareConsumptionPage /></ProtectedRoute>} />
            <Route path="/maintenance/dev-tasks" element={<ProtectedRoute><DevTasksPage /></ProtectedRoute>} />
            <Route path="/maintenance/*" element={<ProtectedRoute><ComingSoon title="Maintenance Module" /></ProtectedRoute>} />

            {/* Sales Routes */}
            <Route path="/sales/dashboard" element={<ProtectedRoute><SalesDashboard /></ProtectedRoute>} />
            <Route path="/sales/customers" element={<ProtectedRoute><CustomersPage /></ProtectedRoute>} />
            <Route path="/sales/customer-logos" element={<ProtectedRoute><CustomerLogosPage /></ProtectedRoute>} />
            <Route path="/sales/quotations" element={<ProtectedRoute><QuotationsPage /></ProtectedRoute>} />
            <Route path="/sales/orders" element={<ProtectedRoute><SalesOrdersPage /></ProtectedRoute>} />
            <Route path="/sales/dispatch" element={<ProtectedRoute><DispatchPage /></ProtectedRoute>} />
            <Route path="/accounting/cogs" element={<ProtectedRoute><COGSPage /></ProtectedRoute>} />
            <Route path="/sales/returns" element={<ProtectedRoute><SalesReturnsPage /></ProtectedRoute>} />
            <Route path="/sales/customer-pricing" element={<ProtectedRoute><CustomerPricingPage /></ProtectedRoute>} />
            <Route path="/sales/visit-dashboard" element={<ProtectedRoute><CustomerVisitDashboard /></ProtectedRoute>} />
            {/* Sales geo masters + fuel (v1 top-ups) */}
            <Route path="/sales/cities" element={<ProtectedRoute><CitiesMasterPage /></ProtectedRoute>} />
            <Route path="/sales/areas" element={<ProtectedRoute><AreasMasterPage /></ProtectedRoute>} />
            <Route path="/sales/categories" element={<ProtectedRoute><CustomerCategoriesMasterPage /></ProtectedRoute>} />
            <Route path="/sales/fuel/trips" element={<ProtectedRoute><SalesFuelTripsPage /></ProtectedRoute>} />
            <Route path="/sales/fuel/payouts" element={<ProtectedRoute><SalesFuelPayoutsPage /></ProtectedRoute>} />
            <Route path="/sales/fuel/vehicles" element={<ProtectedRoute><SalesFuelVehiclesPage /></ProtectedRoute>} />
            <Route path="/sales/fuel/prices" element={<ProtectedRoute><SalesFuelPricesPage /></ProtectedRoute>} />
            <Route path="/sales/*" element={<ProtectedRoute><ComingSoon title="Sales Module" /></ProtectedRoute>} />

            {/* Domestic Sales Routes */}
            <Route path="/domestic/dashboard" element={<ProtectedRoute><DomesticDashboard /></ProtectedRoute>} />
            <Route path="/domestic/customers" element={<ProtectedRoute><DomesticCustomersPage /></ProtectedRoute>} />
            <Route path="/domestic/orders" element={<ProtectedRoute><DomesticOrdersPage /></ProtectedRoute>} />
            <Route path="/domestic/order-status" element={<ProtectedRoute><DomesticOrderStatusPage /></ProtectedRoute>} />
            <Route path="/domestic/new-item" element={<ProtectedRoute><DomesticNewItemPage /></ProtectedRoute>} />
            <Route path="/domestic/item-opening" element={<ProtectedRoute><DomesticItemOpeningPage /></ProtectedRoute>} />
            <Route path="/domestic/pending-dispatch" element={<ProtectedRoute><DomesticPendingDispatchPage /></ProtectedRoute>} />
            <Route path="/domestic/dispatch" element={<ProtectedRoute><DomesticDispatchPage /></ProtectedRoute>} />
            <Route path="/domestic/dispatch-dashboard" element={<ProtectedRoute><DomesticDispatchDashboard /></ProtectedRoute>} />
            <Route path="/domestic/dispatch-acknowledgement" element={<ProtectedRoute><DomesticDispatchAcknowledgementPage /></ProtectedRoute>} />
            <Route path="/domestic/deadline-requests" element={<ProtectedRoute requiredRole="super_admin"><DomesticDeadlineRequestsPage /></ProtectedRoute>} />
            <Route path="/domestic/invoices" element={<ProtectedRoute><DomesticInvoicesPage /></ProtectedRoute>} />
            <Route path="/domestic/packing-types" element={<ProtectedRoute><PackingTypesPage /></ProtectedRoute>} />
            <Route path="/domestic/*" element={<ProtectedRoute><ComingSoon title="Sales" /></ProtectedRoute>} />

            {/* Export Sales Routes */}
            <Route path="/export/dashboard" element={<ProtectedRoute><ExportDashboard /></ProtectedRoute>} />
            <Route path="/export/customers" element={<ProtectedRoute><ExportCustomersPage /></ProtectedRoute>} />
            <Route path="/export/orders" element={<ProtectedRoute><ExportOrdersPage /></ProtectedRoute>} />
            <Route path="/export/dispatch" element={<ProtectedRoute><ExportDispatchPage /></ProtectedRoute>} />
            <Route path="/export/*" element={<ProtectedRoute><ComingSoon title="Export Sales" /></ProtectedRoute>} />

            {/* Purchase Routes */}
            <Route path="/purchase/dashboard" element={<ProtectedRoute><PurchaseDashboard /></ProtectedRoute>} />
            <Route path="/purchase/suppliers" element={<ProtectedRoute><SuppliersPage /></ProtectedRoute>} />
            <Route path="/purchase/orders" element={<ProtectedRoute><PurchaseOrdersPage /></ProtectedRoute>} />
            <Route path="/purchase/grn" element={<ProtectedRoute><GoodsReceiptPage /></ProtectedRoute>} />
            <Route path="/purchase/invoices" element={<ProtectedRoute><PurchaseInvoicesPage /></ProtectedRoute>} />
            <Route path="/purchase/returns" element={<ProtectedRoute><PurchaseReturnsPage /></ProtectedRoute>} />
            <Route path="/purchase/*" element={<ProtectedRoute><ComingSoon title="Purchase Module" /></ProtectedRoute>} />

            {/* Inventory Routes */}
            <Route path="/inventory/dashboard" element={<ProtectedRoute><InventoryDashboard /></ProtectedRoute>} />
            <Route path="/inventory/stock" element={<ProtectedRoute><InventoryStockPage /></ProtectedRoute>} />
            <Route path="/inventory/movements" element={<ProtectedRoute><StockMovementsPage /></ProtectedRoute>} />
            <Route path="/inventory/ledger" element={<ProtectedRoute><InventoryLedgerPage /></ProtectedRoute>} />
            <Route path="/inventory/wip" element={<ProtectedRoute><WIPInventoryPage /></ProtectedRoute>} />
            <Route path="/inventory/locations" element={<ProtectedRoute><InventoryLocationsPage /></ProtectedRoute>} />
            <Route path="/inventory/*" element={<ProtectedRoute><ComingSoon title="Store & Inventory" /></ProtectedRoute>} />

            {/* Floor Inventory Routes */}
            <Route path="/floor-inventory/dashboard" element={<ProtectedRoute><FloorInventoryDashboard /></ProtectedRoute>} />
            <Route path="/floor-inventory/items" element={<ProtectedRoute><FloorInventoryItemsPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/stock" element={<ProtectedRoute><FloorInventoryStockPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/movements" element={<ProtectedRoute><FloorInventoryMovementsPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/production" element={<ProtectedRoute><FloorInventoryProductionPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/ledger" element={<ProtectedRoute><FloorInventoryLedgerPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/locations" element={<ProtectedRoute><FloorInventoryLocationsPage /></ProtectedRoute>} />
            <Route path="/floor-inventory/*" element={<ProtectedRoute><ComingSoon title="Floor Inventory" /></ProtectedRoute>} />

            {/* Master Data Routes */}
            <Route path="/master/departments" element={<ProtectedRoute><DepartmentsPage /></ProtectedRoute>} />
            <Route path="/master/grades" element={<ProtectedRoute><GradesPage /></ProtectedRoute>} />
            <Route path="/master/products" element={<ProtectedRoute><ProductsPage /></ProtectedRoute>} />
            <Route path="/master/units" element={<ProtectedRoute><UnitsPage /></ProtectedRoute>} />
            <Route path="/master/reasons" element={<ProtectedRoute><ReasonsPage /></ProtectedRoute>} />
            <Route path="/master/items" element={<ProtectedRoute><ItemsPage /></ProtectedRoute>} />
            <Route path="/master/hourly-loss-reasons" element={<ProtectedRoute><HourlyLossReasonsPage /></ProtectedRoute>} />
            <Route path="/master/*" element={<ProtectedRoute><ComingSoon title="Master Data" /></ProtectedRoute>} />

            {/* Labour Productivity Routes */}
            <Route path="/labour/dashboard" element={<ProtectedRoute><LabourProductivityDashboard /></ProtectedRoute>} />
            <Route path="/labour/process-dashboard" element={<ProtectedRoute><ProcessProductivityDashboard /></ProtectedRoute>} />
            <Route path="/labour/category-dashboard" element={<ProtectedRoute><CategoryProductivityDashboard /></ProtectedRoute>} />
            <Route path="/labour/entry" element={<ProtectedRoute><LabourProductivityEntryPage /></ProtectedRoute>} />
            <Route path="/labour/process-targets" element={<ProtectedRoute><LabourProcessTargetsPage /></ProtectedRoute>} />
            <Route path="/labour/todays-target" element={<ProtectedRoute><LabourTodaysTargetPage /></ProtectedRoute>} />
            <Route path="/labour/deployment-analysis" element={<ProtectedRoute requiredModule="labour" requiredPermission="approve"><LabourDeploymentAnalysisPage /></ProtectedRoute>} />
            <Route path="/labour/employees" element={<ProtectedRoute><LabourEmployeesPage /></ProtectedRoute>} />
            <Route path="/labour/categories" element={<ProtectedRoute><LabourCategoriesPage /></ProtectedRoute>} />
            <Route path="/labour/attendance" element={<ProtectedRoute><LabourAttendancePage /></ProtectedRoute>} />
            <Route path="/labour/salary" element={<ProtectedRoute><LabourSalaryPage /></ProtectedRoute>} />
            <Route path="/labour/public-holidays" element={<ProtectedRoute><LabourPublicHolidaysPage /></ProtectedRoute>} />
            <Route path="/labour/individual-performance" element={<ProtectedRoute><IndividualPerformanceDashboard /></ProtectedRoute>} />
            <Route path="/labour/mph-management" element={<ProtectedRoute><LabourMPHManagementPage /></ProtectedRoute>} />
            <Route path="/labour/edit-requests" element={<ProtectedRoute requiredRole="super_admin"><LabourProductivityEditRequestsPage /></ProtectedRoute>} />
            <Route path="/labour/missing-entries" element={<ProtectedRoute><MissingProductivityEntriesPage /></ProtectedRoute>} />
            <Route path="/labour/time-sheet" element={<ProtectedRoute><LabourTimeSheetPage /></ProtectedRoute>} />
            <Route path="/labour/*" element={<ProtectedRoute><ComingSoon title="Labour Productivity" /></ProtectedRoute>} />

            {/* Fixed Assets Routes */}
            <Route path="/fixed-assets/dashboard" element={<ProtectedRoute><FixedAssetsDashboard /></ProtectedRoute>} />
            <Route path="/fixed-assets/list" element={<ProtectedRoute><FixedAssetsListPage /></ProtectedRoute>} />
            <Route path="/fixed-assets/categories" element={<ProtectedRoute><FixedAssetCategoriesPage /></ProtectedRoute>} />
            <Route path="/fixed-assets/valuations" element={<ProtectedRoute><AssetValuationsPage /></ProtectedRoute>} />
            <Route path="/fixed-assets/disposal" element={<ProtectedRoute><AssetDisposalPage /></ProtectedRoute>} />
            <Route path="/fixed-assets/reconciliation" element={<ProtectedRoute><AssetReconciliationPage /></ProtectedRoute>} />
            <Route path="/fixed-assets/*" element={<ProtectedRoute><ComingSoon title="Fixed Assets" /></ProtectedRoute>} />

            {/* Expense Management Routes */}
            <Route path="/expenses/dashboard" element={<ProtectedRoute><ExpenseDashboard /></ProtectedRoute>} />
            <Route path="/expenses/petty-cash" element={<ProtectedRoute><PettyCashPage /></ProtectedRoute>} />
            <Route path="/expenses/general" element={<ProtectedRoute><GeneralExpensesPage /></ProtectedRoute>} />
            <Route path="/expenses/utilities" element={<ProtectedRoute><UtilityBillsPage /></ProtectedRoute>} />
            <Route path="/expenses/budgets" element={<ProtectedRoute><ExpenseBudgetsPage /></ProtectedRoute>} />
            <Route path="/expenses/master" element={<ProtectedRoute><ExpenseMasterPage /></ProtectedRoute>} />
            <Route path="/expenses/operating-analysis" element={<ProtectedRoute><OperatingExpensesAnalysisPage /></ProtectedRoute>} />
            <Route path="/expenses/*" element={<ProtectedRoute><ComingSoon title="Expense Management" /></ProtectedRoute>} />

            {/* Production Planning Routes */}
            <Route path="/planning/dashboard" element={<ProtectedRoute><ProductionPlanningDashboard /></ProtectedRoute>} />
            <Route path="/planning/weekly" element={<ProtectedRoute><WeeklyPlanningPage /></ProtectedRoute>} />
            <Route path="/planning/capacity" element={<ProtectedRoute><CapacityMasterPage /></ProtectedRoute>} />
            <Route path="/planning/items" element={<ProtectedRoute><PlanningItemMasterPage /></ProtectedRoute>} />
            <Route path="/planning/stock-closing" element={<ProtectedRoute><DailyStockClosingPage /></ProtectedRoute>} />
            <Route path="/planning/closing-dashboard" element={<ProtectedRoute><DailyClosingDashboard /></ProtectedRoute>} />
            <Route path="/planning/skilled-labour" element={<ProtectedRoute><SkilledLabourPlanningPage /></ProtectedRoute>} />
            <Route path="/planning/job-orders" element={<ProtectedRoute><JobOrdersPage /></ProtectedRoute>} />
            <Route path="/planning/job-order-departments" element={<ProtectedRoute><JobOrderDepartmentsPage /></ProtectedRoute>} />
            <Route path="/planning/store-management" element={<ProtectedRoute><StoreManagementPage /></ProtectedRoute>} />
            <Route path="/planning/*" element={<ProtectedRoute><ComingSoon title="Production Planning" /></ProtectedRoute>} />
 
            {/* Material Consumption Routes */}
            <Route path="/consumption/dashboard" element={<ProtectedRoute><ConsumptionDashboard /></ProtectedRoute>} />
            <Route path="/consumption/production-dashboard" element={<ProtectedRoute><ConsumptionProductionDashboard /></ProtectedRoute>} />
            <Route path="/consumption/efficiency-dashboard" element={<ProtectedRoute><ConsumptionEfficiencyDashboard /></ProtectedRoute>} />
            <Route path="/consumption/raw-materials" element={<ProtectedRoute><RawMaterialsPage /></ProtectedRoute>} />
            <Route path="/consumption/products" element={<ProtectedRoute><ConsumptionProductsPage /></ProtectedRoute>} />
            <Route path="/consumption/bom" element={<ProtectedRoute><ConsumptionBOMPage /></ProtectedRoute>} />
            <Route path="/consumption/stock-closing" element={<ProtectedRoute><StockClosingPage /></ProtectedRoute>} />
            <Route path="/consumption/stock-closing-view" element={<ProtectedRoute><StockClosingViewPage /></ProtectedRoute>} />
            <Route path="/consumption/stock-closing-dashboard" element={<ProtectedRoute><ConsumptionStockClosingDashboard /></ProtectedRoute>} />
            <Route path="/consumption/monthly-receipts" element={<ProtectedRoute><MonthlyReceiptViewPage /></ProtectedRoute>} />
            <Route path="/consumption/production-entry" element={<ProtectedRoute><ProductionEntryPage /></ProtectedRoute>} />
            <Route path="/consumption/analysis" element={<ProtectedRoute><ConsumptionAnalysisPage /></ProtectedRoute>} />
            <Route path="/consumption/categories" element={<ProtectedRoute><ConsumptionCategoriesPage /></ProtectedRoute>} />
            <Route path="/consumption/usage-report" element={<ProtectedRoute><ConsumptionUsageReportPage /></ProtectedRoute>} />
            <Route path="/consumption/*" element={<ProtectedRoute><ComingSoon title="Material Consumption" /></ProtectedRoute>} />


            {/* 5S Module Routes */}
            <Route path="/five-s/dashboard" element={<ProtectedRoute><FiveSDashboard /></ProtectedRoute>} />
            <Route path="/five-s/audits" element={<ProtectedRoute><FiveSAuditsPage /></ProtectedRoute>} />
            <Route path="/five-s/action-items" element={<ProtectedRoute><FiveSActionItemsPage /></ProtectedRoute>} />
            <Route path="/five-s/checkpoints" element={<ProtectedRoute><FiveSCheckpointsPage /></ProtectedRoute>} />
            <Route path="/five-s/departments" element={<ProtectedRoute><FiveSDepartmentsPage /></ProtectedRoute>} />
            <Route path="/five-s/*" element={<ProtectedRoute><ComingSoon title="5S Module" /></ProtectedRoute>} />

            {/* Finance Reports Routes */}
            {/* Legacy /finance/* routes removed — module discontinued. Use Accounting instead. */}

            {/* Six Sigma Routes */}
            <Route path="/six-sigma/dashboard" element={<ProtectedRoute><SixSigmaDashboard /></ProtectedRoute>} />
            <Route path="/six-sigma/projects" element={<ProtectedRoute><SixSigmaProjectsPage /></ProtectedRoute>} />
            <Route path="/six-sigma/tools" element={<ProtectedRoute><SixSigmaToolsPage /></ProtectedRoute>} />
            <Route path="/six-sigma/metrics" element={<ProtectedRoute><SixSigmaMetricsPage /></ProtectedRoute>} />
            <Route path="/six-sigma/*" element={<ProtectedRoute><ComingSoon title="Six Sigma" /></ProtectedRoute>} />

            {/* Online Sales Routes */}
            <Route path="/online-sales/dashboard" element={<ProtectedRoute><OnlineSalesDashboard /></ProtectedRoute>} />
            <Route path="/online-sales/platforms" element={<ProtectedRoute><OnlinePlatformMasterPage /></ProtectedRoute>} />
            <Route path="/online-sales/items" element={<ProtectedRoute><OnlineItemMasterPage /></ProtectedRoute>} />
            <Route path="/online-sales/orders" element={<ProtectedRoute><OnlineOrdersPage /></ProtectedRoute>} />
            
            <Route path="/online-sales/returns" element={<ProtectedRoute><OnlineReturnsPage /></ProtectedRoute>} />
            
            <Route path="/online-sales/analysis" element={<ProtectedRoute><OnlineSalesAnalysisPage /></ProtectedRoute>} />
            <Route path="/online-sales/*" element={<ProtectedRoute><ComingSoon title="Online Sales" /></ProtectedRoute>} />

            {/* Project Management Routes */}
            <Route path="/projects" element={<ProtectedRoute><ProjectsDashboard /></ProtectedRoute>} />
            <Route path="/projects/list" element={<ProtectedRoute><ProjectsListPage /></ProtectedRoute>} />
            <Route path="/projects/kanban" element={<ProtectedRoute><ProjectKanbanPage /></ProtectedRoute>} />
            <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>} />
            <Route path="/projects/*" element={<ProtectedRoute><ComingSoon title="Project Management" /></ProtectedRoute>} />

            {/* R&D Routes */}
            <Route path="/rd/dashboard" element={<ProtectedRoute><RDDashboard /></ProtectedRoute>} />
            <Route path="/rd/projects" element={<ProtectedRoute><RDProjectsPage /></ProtectedRoute>} />
            <Route path="/rd/projects/:id" element={<ProtectedRoute><RDProjectDetailPage /></ProtectedRoute>} />
            <Route path="/rd/experiments" element={<ProtectedRoute><RDExperimentsPage /></ProtectedRoute>} />
            <Route path="/rd/*" element={<ProtectedRoute><ComingSoon title="Product Dev & R&D" /></ProtectedRoute>} />

            {/* Hourly Production Floor Display - Public route */}
            <Route path="/hourly-production/floor-display" element={<HourlyProductionFloorDisplay />} />
            {/* Hourly Production Routes */}
            <Route path="/hourly-production/dashboard" element={<ProtectedRoute><HourlyProductionDashboard /></ProtectedRoute>} />
            <Route path="/hourly-production/entry" element={<ProtectedRoute><HourlyProductionEntryPage /></ProtectedRoute>} />
            <Route path="/hourly-production/reports" element={<ProtectedRoute><HourlyProductionReportsPage /></ProtectedRoute>} />
            <Route path="/hourly-production/process-master" element={<ProtectedRoute requiredRole="super_admin"><HourlyProductionProcessMasterPage /></ProtectedRoute>} />
            <Route path="/hourly-production/analysis" element={<ProtectedRoute><HourlyProductionAnalysisPage /></ProtectedRoute>} />
            <Route path="/hourly-production/live-overview" element={<HourlyProductionLiveOverviewPage />} />
            <Route path="/hourly-production/loss-entry" element={<ProtectedRoute><HourlyProductionLossEntryPage /></ProtectedRoute>} />
            <Route path="/hourly-production/loss-logs" element={<ProtectedRoute><HourlyProductionLossLogsPage /></ProtectedRoute>} />
            <Route path="/hourly-production/materials" element={<ProtectedRoute requiredRole="super_admin"><HPMaterialMasterPage /></ProtectedRoute>} />
            <Route path="/hourly-production/material-issuance" element={<ProtectedRoute><HPMaterialIssuancePage /></ProtectedRoute>} />
            <Route path="/hourly-production/material-consumption" element={<ProtectedRoute><HPMaterialConsumptionPage /></ProtectedRoute>} />
            <Route path="/hourly-production/material-analysis" element={<ProtectedRoute><HPMaterialAnalysisPage /></ProtectedRoute>} />
            <Route path="/hourly-production/*" element={<ProtectedRoute><ComingSoon title="Hourly Production" /></ProtectedRoute>} />

            {/* Machine Monitor - Display and QR Scan are public */}
            <Route path="/machine-monitor/display" element={<MachineMonitorDisplay />} />
            <Route path="/machine-monitor/scan" element={<MachineQRScanPage />} />
            <Route path="/machine-monitor/entry" element={<ProtectedRoute><MachineStatusEntryPage /></ProtectedRoute>} />
            <Route path="/machine-monitor/machines" element={<ProtectedRoute><MachineMonitorMachinesPage /></ProtectedRoute>} />
            <Route path="/machine-monitor/breakdown-logs" element={<ProtectedRoute><MachineMonitorBreakdownLogsPage /></ProtectedRoute>} />
            <Route path="/machine-monitor/performance-logs" element={<ProtectedRoute><MachineMonitorPerformanceLogsPage /></ProtectedRoute>} />
            <Route path="/machine-monitor/*" element={<ProtectedRoute><ComingSoon title="Machine Monitor" /></ProtectedRoute>} />

            {/* Accounting (Standalone) Routes */}
            <Route path="/accounting/dashboard" element={<ProtectedRoute><AccountingDashboard /></ProtectedRoute>} />
            <Route path="/accounting/chart-of-accounts" element={<ProtectedRoute><AccountingCoAPage /></ProtectedRoute>} />
            <Route path="/accounting/parties" element={<ProtectedRoute><AccountingPartiesPage /></ProtectedRoute>} />
            <Route path="/accounting/vouchers" element={<ProtectedRoute><AccountingVouchersPage /></ProtectedRoute>} />
            <Route path="/accounting/vouchers/new" element={<ProtectedRoute><NewVoucherPage /></ProtectedRoute>} />
            <Route path="/accounting/day-book" element={<ProtectedRoute><DayBookPage /></ProtectedRoute>} />
            <Route path="/accounting/cash-book" element={<ProtectedRoute><CashBookPage /></ProtectedRoute>} />
            <Route path="/accounting/bank-book" element={<ProtectedRoute><BankBookPage /></ProtectedRoute>} />
            <Route path="/accounting/general-ledger" element={<ProtectedRoute><GeneralLedgerPage /></ProtectedRoute>} />
            <Route path="/accounting/party-ledger" element={<ProtectedRoute><PartyLedgerPage /></ProtectedRoute>} />
            <Route path="/accounting/ar-ap-report" element={<ProtectedRoute><ReceivablesPayablesReportPage /></ProtectedRoute>} />
            <Route path="/accounting/sales-report" element={<ProtectedRoute><AccountingSalesReportPage /></ProtectedRoute>} />
            <Route path="/accounting/sales-analysis" element={<ProtectedRoute><AccountingSalesAnalysisPage /></ProtectedRoute>} />
            <Route path="/accounting/purchase-analysis" element={<ProtectedRoute><AccountingPurchaseAnalysisPage /></ProtectedRoute>} />
            <Route path="/accounting/trial-balance" element={<ProtectedRoute><AccountingTrialBalancePage /></ProtectedRoute>} />
            <Route path="/accounting/profit-loss" element={<ProtectedRoute><AccountingProfitLossPage /></ProtectedRoute>} />
            <Route path="/accounting/balance-sheet" element={<ProtectedRoute><AccountingBalanceSheetPage /></ProtectedRoute>} />
            <Route path="/accounting/default-accounts" element={<ProtectedRoute><DefaultAccountsPage /></ProtectedRoute>} />
            <Route path="/accounting/sales-reconciliation" element={<ProtectedRoute><SalesReconciliationPage /></ProtectedRoute>} />
            <Route path="/accounting/production-cost-recognition" element={<ProtectedRoute><ProductionCostRecognitionPage /></ProtectedRoute>} />
            <Route path="/accounting/production-reconciliation" element={<ProtectedRoute><ProductionReconciliationPage /></ProtectedRoute>} />
            <Route path="/accounting/purchase-reconciliation" element={<ProtectedRoute><PurchaseReconciliationPage /></ProtectedRoute>} />
            <Route path="/accounting/production-output-recognition" element={<ProtectedRoute><ProductionOutputRecognitionPage /></ProtectedRoute>} />
            <Route path="/accounting/customer-receipts" element={<ProtectedRoute><CustomerReceiptsPage /></ProtectedRoute>} />
            <Route path="/accounting/supplier-payments" element={<ProtectedRoute><SupplierPaymentsPage /></ProtectedRoute>} />
            <Route path="/accounting/sales-return" element={<ProtectedRoute><SalesReturnPage /></ProtectedRoute>} />
            <Route path="/accounting/purchase-return" element={<ProtectedRoute><PurchaseReturnPage /></ProtectedRoute>} />
            <Route path="/accounting/period-close" element={<ProtectedRoute><PeriodClosePage /></ProtectedRoute>} />
            <Route path="/accounting/periodic-cogs" element={<ProtectedRoute><PeriodicCOGSPage /></ProtectedRoute>} />
            <Route path="/accounting/audit-log" element={<ProtectedRoute><AccountingAuditLogPage /></ProtectedRoute>} />
            <Route path="/accounting/settings" element={<ProtectedRoute requiredRole="super_admin"><AccountingSettingsPage /></ProtectedRoute>} />
            <Route path="/accounting/*" element={<ProtectedRoute><ComingSoon title="Accounting (Standalone)" /></ProtectedRoute>} />

            {/* CRM Routes */}
            <Route path="/crm/dashboard" element={<ProtectedRoute><CRMDashboard /></ProtectedRoute>} />
            <Route path="/crm/leads" element={<ProtectedRoute><CRMLeadsPage /></ProtectedRoute>} />
            <Route path="/crm/contacts" element={<ProtectedRoute><CRMContactsPage /></ProtectedRoute>} />
            <Route path="/crm/deals" element={<ProtectedRoute><CRMDealsPipelinePage /></ProtectedRoute>} />
            <Route path="/crm/activities" element={<ProtectedRoute><CRMActivitiesPage /></ProtectedRoute>} />
            <Route path="/crm/content" element={<ProtectedRoute requiredModule="crm"><CRMContentPage /></ProtectedRoute>} />
            <Route path="/crm/product-brand" element={<ProtectedRoute requiredModule="crm"><CRMProductBrandPage /></ProtectedRoute>} />
            <Route path="/crm/daily-closing" element={<ProtectedRoute requiredModule="crm"><CRMDailyClosingPage /></ProtectedRoute>} />
            <Route path="/crm/marketing-kpis" element={<ProtectedRoute requiredModule="crm"><CRMMarketingKPIsPage /></ProtectedRoute>} />
            <Route path="/crm/reactivation" element={<ProtectedRoute requiredModule="crm"><CRMReactivationPage /></ProtectedRoute>} />
            <Route path="/crm/aero-courts" element={<ProtectedRoute requiredModule="crm"><AeroCourtsKanbanPage /></ProtectedRoute>} />
            <Route path="/crm/aero-courts/insights" element={<ProtectedRoute requiredModule="crm"><AeroCourtsInsightsPage /></ProtectedRoute>} />
            <Route path="/crm/sample-items" element={<ProtectedRoute requiredModule="crm"><CRMSampleItemsMasterPage /></ProtectedRoute>} />
            <Route path="/crm/sample-inventory" element={<ProtectedRoute requiredModule="crm"><CRMSampleInventoryPage /></ProtectedRoute>} />
            <Route path="/crm/sample-requests" element={<ProtectedRoute requiredModule="crm"><CRMSampleRequestsPage /></ProtectedRoute>} />
            <Route path="/crm/*" element={<ProtectedRoute><ComingSoon title="CRM" /></ProtectedRoute>} />

            {/* Marketing module */}
            <Route path="/marketing" element={<ProtectedRoute requiredModule="marketing"><MarketingDashboard /></ProtectedRoute>} />
            <Route path="/marketing/campaigns" element={<ProtectedRoute requiredModule="marketing"><MarketingCampaignsPage /></ProtectedRoute>} />
            <Route path="/marketing/deliverables" element={<ProtectedRoute requiredModule="marketing"><MarketingDeliverablesKanbanPage /></ProtectedRoute>} />
            <Route path="/marketing/gantt" element={<ProtectedRoute requiredModule="marketing"><MarketingGanttPage /></ProtectedRoute>} />
            <Route path="/marketing/calendar" element={<ProtectedRoute requiredModule="marketing"><MarketingCalendarPage /></ProtectedRoute>} />
            <Route path="/marketing/events" element={<ProtectedRoute requiredModule="marketing"><MarketingEventsPage /></ProtectedRoute>} />
            <Route path="/marketing/meetings" element={<ProtectedRoute requiredModule="marketing"><MarketingMeetingsPage /></ProtectedRoute>} />
            <Route path="/marketing/masters" element={<ProtectedRoute requiredModule="marketing"><MarketingMastersPage /></ProtectedRoute>} />

            {/* Rejections & Wastage module */}
            <Route path="/rejections/dashboard" element={<ProtectedRoute><RejectionsWastagesDashboard /></ProtectedRoute>} />
            <Route path="/rejections/entry" element={<ProtectedRoute><RejectionsWastageEntryPage /></ProtectedRoute>} />
            <Route path="/rejections/rework" element={<ProtectedRoute><ReworkTrackingPage /></ProtectedRoute>} />
            <Route path="/rejections/reasons" element={<ProtectedRoute><RejectionWastageReasonsPage /></ProtectedRoute>} />
            <Route path="/rejections/units" element={<ProtectedRoute><RWUnitsMasterPage /></ProtectedRoute>} />
            <Route path="/rejections/dispositions" element={<ProtectedRoute><RWDispositionsMasterPage /></ProtectedRoute>} />
            <Route path="/rejections/materials" element={<ProtectedRoute><RWMaterialsMasterPage /></ProtectedRoute>} />
            <Route path="/rejections/analytics" element={<ProtectedRoute><RejectionsAnalyticsPage /></ProtectedRoute>} />

            {/* WIP Management module */}
            <Route path="/wip/dashboard" element={<ProtectedRoute><WIPMonitorDashboard /></ProtectedRoute>} />
            <Route path="/wip/entries" element={<ProtectedRoute><WIPStockEntryPage /></ProtectedRoute>} />
            <Route path="/wip/stages" element={<ProtectedRoute><WIPStagesPage /></ProtectedRoute>} />
            <Route path="/wip/thresholds" element={<ProtectedRoute><WIPThresholdsPage /></ProtectedRoute>} />
            <Route path="/wip/flow" element={<ProtectedRoute><WIPFlowAnalysisPage /></ProtectedRoute>} />

            {/* Distributor Order Management module (Phase 1) */}
            <Route path="/distributor/dashboard" element={<ProtectedRoute requiredModule="distributor"><DistributorDashboard /></ProtectedRoute>} />
            <Route path="/distributor/distributors" element={<ProtectedRoute requiredRole="super_admin"><DistributorsMasterPage /></ProtectedRoute>} />
            <Route path="/distributor/customers" element={<ProtectedRoute requiredModule="distributor"><DistributorCustomersPage /></ProtectedRoute>} />
            <Route path="/distributor/products" element={<ProtectedRoute requiredModule="distributor"><DistributorProductsPage /></ProtectedRoute>} />
            <Route path="/distributor/orders" element={<ProtectedRoute requiredModule="distributor"><DistributorOrdersPage /></ProtectedRoute>} />
            <Route path="/distributor/analysis" element={<ProtectedRoute requiredModule="distributor"><DistributorOrderAnalysisPage /></ProtectedRoute>} />
            <Route path="/distributor/approvals" element={<ProtectedRoute requiredModule="distributor"><DistributorApprovalsPage /></ProtectedRoute>} />
            <Route path="/distributor/dispatch" element={<ProtectedRoute requiredModule="distributor"><DistributorDispatchPage /></ProtectedRoute>} />
            <Route path="/distributor/admin/users" element={<ProtectedRoute requiredModule="distributor"><DistributorUsersPage /></ProtectedRoute>} />
            <Route path="/distributor/*" element={<ProtectedRoute requiredModule="distributor"><ComingSoon title="Distributor Orders" /></ProtectedRoute>} />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </RoutedContent>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;