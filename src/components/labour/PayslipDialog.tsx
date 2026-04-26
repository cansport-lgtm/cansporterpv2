import { useRef } from "react";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface PayslipData {
  employee_code: string;
  full_name: string;
  production_departments?: { id: string; name: string } | null;
  monthly_salary: number;
  dailyRate: number;
  fullDays: number;
  halfDays: number;
  paidSundays: number;
  totalMph: number;
  totalAdvance: number;
  totalTravelAdvance: number;
  totalAttAllowance: number;
  totalOvertime: number;
  grossSalary: number;
  earnedSalary: number;
  daysWorked: number;
}

interface PayslipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: PayslipData | null;
  month: string;
}

export const PayslipDialog = ({ open, onOpenChange, employee, month }: PayslipDialogProps) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!employee) return null;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
  const monthDisplay = format(new Date(`${month}-01`), "MMMM yyyy");
  const departmentName = employee.production_departments?.name || '-';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Payslip - ${employee.full_name}</title>
          <style>
            @page {
              size: 21cm 14.85cm;
              margin: 0;
            }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body {
              width: 21cm;
              height: 14.85cm;
              overflow: hidden;
            }
            body { 
              font-family: Arial, sans-serif; 
              padding: 10mm 12mm;
              font-size: 11px;
              width: 21cm;
              height: 14.85cm;
            }
            .payslip { 
              width: 100%;
              height: 100%;
              display: flex;
              flex-direction: column;
            }
            .header { 
              text-align: center; 
              border-bottom: 2px solid #000;
              padding-bottom: 4mm;
              margin-bottom: 4mm;
            }
            .header h1 { font-size: 16px; margin-bottom: 2px; font-weight: bold; }
            .header h2 { font-size: 12px; font-weight: normal; color: #333; }
            .employee-info {
              display: flex;
              justify-content: space-between;
              margin-bottom: 4mm;
              padding: 3mm 4mm;
              background: #f0f0f0;
              border: 1px solid #ccc;
            }
            .info-group label { font-weight: bold; display: block; font-size: 9px; color: #555; }
            .info-group span { font-size: 11px; font-weight: 600; }
            .content-row {
              display: flex;
              gap: 4mm;
              flex: 1;
            }
            .earnings-section {
              flex: 1;
            }
            .earnings-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 10px;
            }
            .earnings-table th, .earnings-table td {
              border: 1px solid #ccc;
              padding: 2.5mm 3mm;
              text-align: left;
            }
            .earnings-table th {
              background: #e8e8e8;
              font-weight: bold;
              font-size: 9px;
            }
            .earnings-table td:last-child {
              text-align: right;
              white-space: nowrap;
            }
            .total-row {
              font-weight: bold;
              background: #d4edda;
            }
            .total-row td {
              font-size: 12px;
              padding: 3mm !important;
            }
            .green { color: #16a34a; }
            .red { color: #dc2626; }
            .signature-section {
              display: flex;
              justify-content: space-between;
              margin-top: 6mm;
              padding-top: 4mm;
            }
            .signature-box {
              text-align: center;
              font-size: 9px;
            }
            .signature-line {
              width: 45mm;
              border-top: 1px solid #000;
              padding-top: 2mm;
            }
            @media print {
              @page {
                size: 21cm 14.85cm;
                margin: 0;
              }
              html, body {
                width: 21cm;
                height: 14.85cm;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="payslip">
            <div class="header">
              <h1>PAYSLIP - ${monthDisplay.toUpperCase()}</h1>
            </div>
            
            <div class="employee-info">
              <div class="info-group">
                <label>CODE</label>
                <span>${employee.employee_code}</span>
              </div>
              <div class="info-group">
                <label>NAME</label>
                <span>${employee.full_name}</span>
              </div>
              <div class="info-group">
                <label>DEPARTMENT</label>
                <span>${departmentName}</span>
              </div>
              <div class="info-group">
                <label>DAYS WORKED</label>
                <span>${employee.daysWorked}</span>
              </div>
            </div>

            <div class="content-row">
              <div class="earnings-section">
                <table class="earnings-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Details</th>
                      <th>Amount (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Monthly Salary</td>
                      <td>Base</td>
                      <td>${employee.monthly_salary.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Full Days (${employee.fullDays})</td>
                      <td>@ Rs.${employee.dailyRate.toFixed(0)}</td>
                      <td>${(employee.fullDays * employee.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr>
                      <td>Half Days (${employee.halfDays})</td>
                      <td>@ 50%</td>
                      <td>${(employee.halfDays * employee.dailyRate * 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr>
                      <td>Paid Sundays (${employee.paidSundays})</td>
                      <td></td>
                      <td>${(employee.paidSundays * employee.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr class="green">
                      <td>Overtime</td>
                      <td></td>
                      <td>+${employee.totalOvertime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr class="green">
                      <td>Att. Allowance</td>
                      <td></td>
                      <td>+${employee.totalAttAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr>
                      <td><strong>Gross</strong></td>
                      <td></td>
                      <td><strong>${employee.grossSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td>
                    </tr>
                    <tr class="red">
                      <td>Less: Advance</td>
                      <td></td>
                      <td>-${employee.totalAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr class="red">
                      <td>Less: Travel Advance</td>
                      <td></td>
                      <td>-${employee.totalTravelAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                    <tr class="total-row">
                      <td colspan="2"><strong>NET PAYABLE</strong></td>
                      <td><strong>Rs. ${employee.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="signature-section">
              <div class="signature-box">
                <div class="signature-line">Employee Signature</div>
              </div>
              <div class="signature-box">
                <div class="signature-line">Authorized Signature</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const monthDisplay = format(new Date(`${month}-01`), "MMMM yyyy");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby="payslip-description">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Payslip - {monthDisplay}</span>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogTitle>
          <p id="payslip-description" className="sr-only">
            Monthly payslip details for {employee.full_name}
          </p>
        </DialogHeader>

        <div ref={printRef} className="space-y-4">
          <div className="grid grid-cols-3 gap-4 p-3 bg-muted rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Code</p>
              <p className="font-medium">{employee.employee_code}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-medium">{employee.full_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Department</p>
              <p className="font-medium">{employee.production_departments?.name || '-'}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Salary</span>
              <span>Rs. {employee.monthly_salary.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Daily Rate</span>
              <span>Rs. {employee.dailyRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Full Days ({employee.fullDays})</span>
              <span>Rs. {(employee.fullDays * employee.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Half Days ({employee.halfDays})</span>
              <span>Rs. {(employee.halfDays * employee.dailyRate * 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Paid Sundays ({employee.paidSundays})</span>
              <span>Rs. {(employee.paidSundays * employee.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
              <span>Overtime Payment</span>
              <span>Rs. {employee.totalOvertime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
              <span>Attendance Allowance</span>
              <span>Rs. {employee.totalAttAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm font-medium">
              <span>Gross Salary</span>
              <span>Rs. {employee.grossSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm text-destructive">
              <span>Less: Advance</span>
              <span>Rs. {employee.totalAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm text-destructive">
              <span>Less: Travel Advance</span>
              <span>Rs. {employee.totalTravelAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg pt-2">
              <span>Net Payable</span>
              <span className="text-primary">Rs. {employee.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
