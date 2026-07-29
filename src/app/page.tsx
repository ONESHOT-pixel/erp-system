'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Barcode from 'react-barcode';
import { supabase } from '@/lib/supabaseClient';
import PaymentLedger, { type PaymentRecord } from '@/components/PaymentLedger';

// --- Types ---
type Product = {
  id: string;
  barcode: string;
  name: string;
  category: string;
  quantity: number;
  lowStockAlert: number;
  costPrice: number;
  price: number;
  imageUrl?: string;
};

type PurchaseItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  costPrice: number;
  total: number;
};

type ExpenseRecord = {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
};


type PurchaseInvoice = {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  date: string;
  items: PurchaseItem[];
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'paid' | 'credit';
  dueDate?: string;
  notes: string;
  payments?: PaymentRecord[];
};

type DamageRecord = {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  costPrice: number;
  totalLoss: number;
  reason: string;
  date: string;
};

type ProductionRecord = {
  id: string;
  producedItemId: string;
  producedItemName: string;
  quantityProduced: number;
  totalCost: number;
  components: {
    itemId: string;
    itemName: string;
    quantityUsed: number;
    costPrice: number;
  }[];
  date: string;
};

type UsedPart = {
  itemId: string;
  itemName: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
};

type MaintenanceStatus = 'pending' | 'in_progress' | 'waiting_parts' | 'completed' | 'rejected';

type MaintenanceTicket = {
  id: string;
  ticketNumber: string;
  customerName: string;
  customerPhone: string;
  deviceType: string;
  issueDescription: string;
  status: MaintenanceStatus;
  usedParts: UsedPart[];
  estimatedCost: number; // labor + parts
  deposit: number;
  warrantyPeriod: string;
  receiveDate: string;
  deliveryDate?: string;
};

type CartItem = Product & {
  cartQuantity: number;
  total: number;
};

type SalesInvoice = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  date: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'paid' | 'credit';
  dueDate?: string;
  payments?: PaymentRecord[];
};

// --- مولّدات المعرفات والأرقام ---
// Date.now و Math.random دوال غير نقية. كل الاستدعاءات هنا تحدث داخل معالِجات
// أحداث (لا أثناء الرسم)، لكن React Compiler لا يستطيع إثبات ذلك إذا كُتبت
// داخل جسم المكوّن، فيرفضها. وضعها هنا على مستوى الوحدة يحلّ المشكلة
// دون تغيير السلوك.
const newId = () => Date.now().toString();
const newTempProductId = () => `NEW_${Date.now()}`;
const newTempProducedId = () => `NEW_PROD_${Date.now()}`;
const newBarcode = () => Math.floor(1000000000 + Math.random() * 9000000000).toString();
const newInvoiceNumber = () => `INV-${Math.floor(1000 + Math.random() * 9000)}`;
const newPurchaseNumber = () => `PUR-${Math.floor(1000 + Math.random() * 9000)}`;
const newTicketNumber = () => `MN-${Math.floor(10000 + Math.random() * 90000)}`;
const newProductionBarcode = () => `PROD-${Math.floor(10000 + Math.random() * 90000)}`;

// --- جسر الأسماء بين الكود وقاعدة البيانات ---
// أعمدة جدول products بأحرف صغيرة بلا فواصل (lowstockalert لا lowStockAlert).
const toDbProduct = (p: Product) => ({
  barcode: p.barcode,
  name: p.name,
  category: p.category,
  quantity: p.quantity,
  lowstockalert: p.lowStockAlert,
  costprice: p.costPrice,
  price: p.price,
  image_url: p.imageUrl || null,
});

// الاتجاه المعاكس: صف قاعدة البيانات -> شكل المادة داخل التطبيق.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromDbProduct = (d: any): Product => ({
  id: d.id.toString(),
  barcode: d.barcode,
  name: d.name,
  category: d.category,
  quantity: d.quantity,
  lowStockAlert: d.lowstockalert ?? 5,
  costPrice: d.costprice ?? 0,
  price: d.price ?? 0,
  imageUrl: d.image_url || undefined,
});

/**
 * يرفع صورة المادة إلى مخزن Supabase ويُعيد رابطها العام.
 * اسم الملف عشوائي حتى لا تتصادم الصور ذات الاسم نفسه.
 */
const uploadProductImage = async (
  file: File
): Promise<{ url: string | null; error: string | null }> => {
  if (!file.type.startsWith('image/')) {
    return { url: null, error: 'الملف المختار ليس صورة.' };
  }
  if (file.size > 3 * 1024 * 1024) {
    return { url: null, error: 'حجم الصورة أكبر من 3 ميغابايت. اختر صورة أصغر.' };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, file, { cacheControl: '31536000', upsert: false });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
};

const toDbPurchase = (inv: PurchaseInvoice) => ({
  invoice_number: inv.invoiceNumber,
  supplier_name: inv.supplierName,
  date: inv.date,
  total_amount: inv.totalAmount,
  paid_amount: inv.paidAmount,
  payment_status: inv.paymentStatus,
  items: inv.items,
  notes: inv.notes,
  payments: inv.payments || [],
});

const toDbMaintenance = (t: MaintenanceTicket) => ({
  ticket_number: t.ticketNumber,
  customer_name: t.customerName,
  phone: t.customerPhone,
  device_type: t.deviceType,
  issue_description: t.issueDescription,
  estimated_cost: t.estimatedCost,
  status: t.status,
  date: t.receiveDate,
  used_parts: t.usedParts,
  deposit: t.deposit,
  warranty_period: t.warrantyPeriod,
});

/**
 * يزامن تغييرات المخزون مع قاعدة البيانات.
 *
 * المواد التي لم تكن موجودة في القائمة السابقة (المضافة تلقائياً من فاتورة
 * شراء أو من الإنتاج) تُدرَج وتأخذ معرّفها الحقيقي بدل المعرّف المؤقت.
 * الباقي تُحدَّث كميته فقط وفقط إذا تغيّرت فعلاً.
 *
 * يُرجع القائمة بعد استبدال المعرفات المؤقتة، وأول خطأ حصل إن وُجد.
 */
const persistProductChanges = async (
  next: Product[],
  prev: Product[]
): Promise<{ products: Product[]; error: string | null }> => {
  const result = [...next];
  let firstError: string | null = null;

  for (let i = 0; i < result.length; i++) {
    const p = result[i];
    const before = prev.find((o) => o.id === p.id);

    if (!before) {
      const { data, error } = await supabase.from('products').insert([toDbProduct(p)]).select();
      if (error) {
        firstError = firstError ?? error.message;
        continue;
      }
      if (data && data.length > 0) result[i] = { ...p, id: data[0].id.toString() };
    } else if (before.quantity !== p.quantity) {
      const { error } = await supabase.from('products').update({ quantity: p.quantity }).eq('id', p.id);
      if (error) firstError = firstError ?? error.message;
    }
  }

  return { products: result, error: firstError };
};

// الوصل الحراري يخدم نوعي المستند (بيع/صيانة) فيقرأ الحقول المشتركة بينهما
// وما يخصّ كل نوع. لذلك الحقول الخاصة اختيارية.
// cartQuantity هي الكمية المباعة. الحقل quantity في CartItem يحمل رصيد
// المخزن وقت البيع، وطباعته على وصل الزبون تعطي رقماً خاطئاً تماماً.
type ReceiptItem = { name: string; cartQuantity: number; total: number };

type ReceiptData = {
  customerName?: string;
  totalAmount: number;
  // خاص بفواتير البيع
  items?: ReceiptItem[];
  invoiceNumber?: string;
  date?: string;
  paymentStatus?: string;
  paidAmount?: number;
  // خاص بتذاكر الصيانة
  ticketNumber?: string;
  receiveDate?: string;
  deviceType?: string;
  estimatedCost?: number;
  deposit?: number;
};

export const generateThermalReceipt = (data: ReceiptData, type: 'sales' | 'maintenance') => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const getPaymentMethodAr = (method: string) => {
    if (method === 'cash') return 'نقدي';
    if (method === 'credit') return 'آجل (دين)';
    return method;
  };

  let itemsHtml = '';
  if (type === 'sales') {
    itemsHtml = (data.items || []).map((item) => `
      <tr>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc;">${item.name}</td>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc; text-align: center;">${item.cartQuantity}</td>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc; text-align: left;">${item.total.toLocaleString()}</td>
      </tr>
    `).join('');
  } else if (type === 'maintenance') {
    itemsHtml = `
      <tr>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc;">${data.deviceType}</td>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc; text-align: center;">1</td>
        <td style="padding: 4px 0; border-bottom: 1px dashed #ccc; text-align: left;">${(data.estimatedCost || 0).toLocaleString()}</td>
      </tr>
    `;
  }

  const html = `
    <html>
      <head>
        <title>طباعة وصل</title>
        <style>
          body { font-family: 'Tahoma', sans-serif; margin: 0; padding: 10px; width: 80mm; font-size: 12px; color: #000; }
          .header { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header h2 { margin: 0; font-size: 18px; }
          .header p { margin: 2px 0; font-size: 12px; }
          .meta { margin-bottom: 10px; }
          .meta table { width: 100%; font-size: 12px; }
          .meta td { padding: 2px 0; }
          .items { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          .items th { border-bottom: 1px solid #000; padding: 4px 0; text-align: right; }
          .items th:nth-child(2) { text-align: center; }
          .items th:last-child { text-align: left; }
          .totals { width: 100%; margin-bottom: 10px; border-top: 2px solid #000; padding-top: 10px; font-weight: bold; }
          .totals table { width: 100%; font-size: 12px; }
          .totals td { padding: 2px 0; }
          .footer { text-align: center; font-size: 10px; margin-top: 10px; border-top: 1px dashed #000; padding-top: 10px; }
        </style>
      </head>
      <body onload="window.print(); window.close();" dir="rtl">
        <div class="header">
          <h2>نظام إدارة الموارد</h2>
          <p>العنوان - بغداد</p>
          <p>هاتف: 07700000000</p>
        </div>
        
        <div class="meta">
          <table>
            <tr><td>رقم الوصل:</td><td style="text-align: left;">${type === 'sales' ? data.invoiceNumber : data.ticketNumber}</td></tr>
            <tr><td>التاريخ:</td><td style="text-align: left;">${type === 'sales' ? data.date : data.receiveDate}</td></tr>
            <tr><td>الزبون:</td><td style="text-align: left;">${data.customerName || 'زبون نقدي'}</td></tr>
            ${type === 'sales' ? `<tr><td>نوع الدفع:</td><td style="text-align: left;">${getPaymentMethodAr(data.paymentStatus || '')}</td></tr>` : ''}
          </table>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th>المادة</th>
              <th>العدد</th>
              <th>المجموع</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="totals">
          <table>
            ${type === 'sales' ? `
              <tr><td>الإجمالي:</td><td style="text-align: left;">${data.totalAmount.toLocaleString()} د.ع</td></tr>
              ${data.paymentStatus === 'credit' ? `
                <tr><td>الواصل:</td><td style="text-align: left;">${(data.paidAmount || 0).toLocaleString()} د.ع</td></tr>
                <tr><td>الباقي:</td><td style="text-align: left;">${(data.totalAmount - (data.paidAmount || 0)).toLocaleString()} د.ع</td></tr>
              ` : ''}
            ` : `
              <tr><td>كلفة التقدير:</td><td style="text-align: left;">${(data.estimatedCost || 0).toLocaleString()} د.ع</td></tr>
              <tr><td>العربون:</td><td style="text-align: left;">${(data.deposit || 0).toLocaleString()} د.ع</td></tr>
              <tr><td>المتبقي:</td><td style="text-align: left;">${((data.estimatedCost || 0) - (data.deposit || 0)).toLocaleString()} د.ع</td></tr>
            `}
          </table>
        </div>

        <div class="footer">
          <p>البضاعة المباعة لا ترد ولا تستبدل إلا بوجود الفاتورة</p>
          <p>شكراً لزيارتكم!</p>
          <p style="margin-top: 10px; font-weight: bold;">نظام ERP المحاسبي</p>
        </div>
      </body>
    </html>
  `;
  
  printWindow.document.write(html);
  printWindow.document.close();
};

export default function App() {
  // --- Global State ---
  const [activeTab, setActiveTab] = useState<'inventory' | 'purchasing' | 'sales' | 'production' | 'maintenance' | 'reports'>('sales');
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [reportFilter, setReportFilter] = useState({ startDate: '', endDate: '' });
  const [expenseModal, setExpenseModal] = useState({isOpen: false, amount: '', category: 'عام', note: ''});
  const [barcodeModal, setBarcodeModal] = useState<{isOpen: boolean, product: Product | null}>({isOpen: false, product: null});
  const EXCHANGE_RATE = 1520; // 1 USD = 1520 IQD

  // --- Inventory State ---

  const [newCategory, setNewCategory] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  
  // التصنيفات المخزّنة في قاعدة البيانات (أو localStorage عند تعذّر الاتصال).
  const [baseCategories, setBaseCategories] = useState<string[]>(['إلكترونيات', 'إكسسوارات', 'شاشات']);

  // القائمة المعروضة = تصنيفات قاعدة البيانات + أي تصنيف مستخدَم فعلاً في المواد.
  // مشتقّة بدل تخزينها في state، فلا نحتاج effect يكتب state عند كل تغيّر للمواد.
  const categories = useMemo(
    () => Array.from(new Set([...baseCategories, ...products.map(p => p.category).filter(Boolean)])),
    [baseCategories, products]
  );


  const [isInvModalOpen, setIsInvModalOpen] = useState(false);
  const [invModalType, setInvModalType] = useState<'add' | 'edit'>('add');
  const [invEditingId, setInvEditingId] = useState<string | null>(null);
  const [invFormData, setInvFormData] = useState<Product>({ id: '', barcode: '', name: '', category: '', quantity: 0, lowStockAlert: 5, costPrice: 0, price: 0 });
  const [imageUploading, setImageUploading] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  // --- Purchasing State ---
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [isPurModalOpen, setIsPurModalOpen] = useState(false);
  const [purModalType, setPurModalType] = useState<'add' | 'edit'>('add');
  const [purEditingId, setPurEditingId] = useState<string | null>(null);
  const [purFormData, setPurFormData] = useState<PurchaseInvoice>({ id: '', invoiceNumber: '', supplierName: '', date: '', items: [], totalAmount: 0, paidAmount: 0, paymentStatus: 'paid', dueDate: '', notes: '' });
  const [currentPurItem, setCurrentPurItem] = useState<{ name: string, quantity: number, costPrice: number }>({ name: '', quantity: 1, costPrice: 0 });
  const [isViewPurModalOpen, setIsViewPurModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);

  // --- Sales (POS) State ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [salesPaymentStatus, setSalesPaymentStatus] = useState<'paid' | 'credit'>('paid');
  const [salesPaidAmount, setSalesPaidAmount] = useState<number>(0);
  const [salesDueDate, setSalesDueDate] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('زبون نقدي');
  const [activePosCategory, setActivePosCategory] = useState<string>('الكل');
  const [isCatDropdownOpen, setIsCatDropdownOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [searchPos, setSearchPos] = useState('');
  const [salesInvoices, setSalesInvoices] = useState<SalesInvoice[]>([]);
  const [isDailyStatsOpen, setIsDailyStatsOpen] = useState(false);
  const [successModal, setSuccessModal] = useState<{isOpen: boolean, invoice: SalesInvoice | null}>({isOpen: false, invoice: null});
  const [errorModal, setErrorModal] = useState<{isOpen: boolean, message: string}>({isOpen: false, message: ''});
  const [receiptModal, setReceiptModal] = useState<{isOpen: boolean, invoice: SalesInvoice | null}>({isOpen: false, invoice: null});
  // تعديل فاتورة بيع: البيانات الوصفية فقط. تعديل المواد يتطلب إعادة
  // تسوية المخزون، والمسار الطبيعي في نقطة البيع هو حذف الفاتورة وإعادة بيعها.
  const [salesEditModal, setSalesEditModal] = useState<{isOpen: boolean, id: string, customerName: string, date: string, dueDate: string}>({isOpen: false, id: '', customerName: '', date: '', dueDate: ''});

  // Production & Damages State
  const [damages, setDamages] = useState<DamageRecord[]>([]);
  const [productions, setProductions] = useState<ProductionRecord[]>([]);
  const [isDamageModalOpen, setIsDamageModalOpen] = useState(false);
  const [isProductionModalOpen, setIsProductionModalOpen] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{isOpen: boolean, type: 'purchase' | 'sales', invoiceId: string, amount: number, date: string, method: string}>({isOpen: false, type: 'purchase', invoiceId: '', amount: 0, date: new Date().toISOString().split('T')[0], method: 'نقدي'});
  const [damageFormData, setDamageFormData] = useState({ itemId: '', itemName: '', quantity: 1, reason: 'سوء خزن', costPrice: 0 });
  
  type ProdComponent = { itemId: string; itemName: string; quantityUsed: number; costPrice: number };
  const [productionFormData, setProductionFormData] = useState({ producedItemName: '', category: 'الكترونيات', quantityProduced: 1, components: [] as ProdComponent[] });
  const [prodComponentInput, setProdComponentInput] = useState<ProdComponent>({ itemId: '', itemName: '', quantityUsed: 1, costPrice: 0 });

  // Maintenance State
  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>([]);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [maintenanceModalType, setMaintenanceModalType] = useState<'add' | 'edit'>('add');
  const [maintenanceFormData, setMaintenanceFormData] = useState<MaintenanceTicket>({
    id: '', ticketNumber: '', customerName: '', customerPhone: '', deviceType: '', issueDescription: '', status: 'pending', usedParts: [], estimatedCost: 0, deposit: 0, warrantyPeriod: 'بدون ضمان', receiveDate: ''
  });
  const [partInput, setPartInput] = useState<UsedPart>({ itemId: '', itemName: '', quantity: 1, costPrice: 0, sellPrice: 0 });

  // Custom Delete Confirmation Modal
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, id: string, type: 'inventory' | 'purchasing' | 'sales', title: string }>({ isOpen: false, id: '', type: 'inventory', title: '' });

  const fetchCategories = async () => {
    const { data, error } = await supabase.from('categories').select('name');
    if (data && !error) {
      setBaseCategories(data.map(d => d.name));
      return;
    }
    const saved = localStorage.getItem('pos_categories');
    if (saved) setBaseCategories(JSON.parse(saved));
  };

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: false });
    if (data) {
      const mapped = data.map(d => ({
        ...d,
        id: d.id.toString(),
        lowStockAlert: d.lowstockalert !== undefined ? d.lowstockalert : d.lowStockAlert,
        costPrice: d.costprice !== undefined ? d.costprice : d.costPrice,
        imageUrl: d.image_url || undefined
      }));
      setProducts(mapped);
    }
  };

  const fetchPurchases = async () => {
    const { data } = await supabase.from('purchases').select('*').order('id', { ascending: false });
    if (data) {
      const mapped = data.map(d => ({
        id: d.id.toString(), invoiceNumber: d.invoice_number, supplierName: d.supplier_name, date: d.date, items: d.items || [],
        totalAmount: d.total_amount, paidAmount: d.paid_amount || 0, paymentStatus: d.payment_status, notes: d.notes || '', payments: d.payments || []
      }));
      setPurchases(mapped);
    }
  };

  const fetchSales = async () => {
    const { data } = await supabase.from('sales_invoices').select('*').order('id', { ascending: false });
    if (data) {
      const mapped = data.map(d => ({
        id: d.id.toString(), invoiceNumber: d.invoice_number, customerName: d.customer_name, date: d.date, items: d.items || [],
        totalAmount: d.total_amount, paidAmount: d.paid_amount || 0, paymentStatus: d.payment_status, dueDate: d.due_date || '', payments: d.payments || [],
        subtotal: d.subtotal ?? d.total_amount, discount: d.discount || 0
      }));
      setSalesInvoices(mapped);
    }
  };

  const fetchExpenses = async () => {
    const { data } = await supabase.from('expenses').select('*').order('id', { ascending: false });
    // العمود في قاعدة البيانات اسمه description بينما الحقل في التطبيق note؛
    // نسخ الصف كما هو كان يترك note فارغاً فتضيع الملاحظات عند العرض.
    if (data) setExpenses(data.map(d => ({
      id: d.id.toString(),
      date: d.date,
      amount: d.amount,
      category: d.category,
      note: d.description || '',
    })));
  };

  const fetchMaintenance = async () => {
    const { data } = await supabase.from('maintenance_tickets').select('*').order('id', { ascending: false });
    if (data) {
      const mapped = data.map(d => ({
        id: d.id.toString(), ticketNumber: d.ticket_number || `MN-${d.id}`, customerName: d.customer_name, customerPhone: d.phone, deviceType: d.device_type,
        issueDescription: d.issue_description, status: d.status, estimatedCost: d.estimated_cost || 0, receiveDate: d.date,
        usedParts: d.used_parts || [], deposit: d.deposit || 0, warrantyPeriod: d.warranty_period || ''
      }));
      setMaintenanceTickets(mapped);
    }
  };

  const fetchDamages = async () => {
    const { data } = await supabase.from('damages').select('*').order('id', { ascending: false });
    if (data) setDamages(data.map(d => ({ id: d.id.toString(), itemId: d.item_id, itemName: d.item_name, quantity: d.quantity, costPrice: d.cost_price, totalLoss: d.total_loss, reason: d.reason, date: d.date })));
  };

  const fetchProductions = async () => {
    const { data } = await supabase.from('productions').select('*').order('id', { ascending: false });
    if (data) setProductions(data.map(d => ({ id: d.id.toString(), producedItemId: d.produced_item_id, producedItemName: d.produced_item_name, quantityProduced: d.quantity_produced, totalCost: d.total_cost || 0, components: d.components || [], date: d.date })));
  };

  // تحميل أولي واحد عند التركيب. معرَّف بعد دوال الجلب وتعريفات الحالة
  // لأن استدعاءها قبل التصريح يخالف قواعد React Compiler.
  //
  // القاعدة set-state-in-effect معطَّلة هنا عن قصد: كل هذه الدوال async
  // وتستدعي setState بعد await، أي في microtask لاحق لا أثناء الرسم.
  // التطبيق static export بلا خادم، فالجلب من العميل هو الطريق الوحيد.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchCategories();
    fetchProducts();
    fetchPurchases();
    fetchSales();
    fetchExpenses();
    fetchMaintenance();
    fetchDamages();
    fetchProductions();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */


  // --- Helper Functions ---
  const getTodayDate = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  const getStockStatus = (quantity: number, alertLevel: number) => {
    if (quantity === 0) return <span className="badge badge-danger">نافذ (0)</span>;
    if (quantity <= alertLevel) return <span className="badge badge-warning">قارب على النفاذ</span>;
    return <span className="badge badge-success">متوفر</span>;
  };


  // --- Inventory Functions ---
  const openInvModal = (type: 'add' | 'edit', product?: Product) => {
    setInvModalType(type);
    if (type === 'edit' && product) {
      setInvEditingId(product.id);
      setInvFormData(product);
    } else {
      setInvEditingId(null);
      setInvFormData({ id: '', barcode: '', name: '', category: categories[0] || '', quantity: 0, lowStockAlert: 5, costPrice: 0, price: 0 });
    }
    setIsInvModalOpen(true);
    setShowAddCategory(false);
  };
  const closeInvModal = () => setIsInvModalOpen(false);
  const generateBarcode = () => setInvFormData({ ...invFormData, barcode: newBarcode() });
  
  const handleAddCategory = async () => {
    if (newCategory.trim() !== '' && !categories.includes(newCategory)) {
      const updated = [...baseCategories, newCategory];
      setBaseCategories(updated);
      setInvFormData({ ...invFormData, category: newCategory });

      await supabase.from('categories').insert([{ name: newCategory }]);
      // نحتفظ بنسخة محلية في الحالتين لتعمل الواجهة عند انقطاع الاتصال.
      localStorage.setItem('pos_categories', JSON.stringify(updated));
    }
    setNewCategory('');
    setShowAddCategory(false);
  };

  const handleDeleteCategory = async () => {
    if (categories.length <= 1) {
      setErrorModal({ isOpen: true, message: 'لا يمكن حذف التصنيف الأخير. يجب أن يتبقى تصنيف واحد على الأقل.' });
      return;
    }
    const hasProducts = products.some(p => p.category === invFormData.category);
    if (hasProducts) {
      setErrorModal({ isOpen: true, message: 'لا يمكن حذف هذا التصنيف لوجود مواد مرتبطة به. يرجى حذف أو تعديل المواد أولاً.' });
      return;
    }
    const categoryToDelete = invFormData.category;
    const updatedCategories = baseCategories.filter(c => c !== categoryToDelete);

    // Update local state first for speed
    setBaseCategories(updatedCategories);
    setInvFormData({ ...invFormData, category: updatedCategories[0] });

    await supabase.from('categories').delete().eq('name', categoryToDelete);
    localStorage.setItem('pos_categories', JSON.stringify(updatedCategories));
  };

  const handleSaveInvModal = async () => {
    if (!invFormData.name || !invFormData.category) return setErrorModal({ isOpen: true, message: 'يرجى ملء الحقول المطلوبة!' });
    const finalBarcode = invFormData.barcode || newBarcode();
    const finalProduct = toDbProduct({ ...invFormData, barcode: finalBarcode });
    
    if (invModalType === 'add') {
      const { data, error } = await supabase.from('products').insert([finalProduct]).select();
      if (error) return setErrorModal({ isOpen: true, message: 'خطأ: ' + error.message });
      if (data && data.length > 0) setProducts([fromDbProduct(data[0]), ...products]);
    } else {
      const { data, error } = await supabase.from('products').update(finalProduct).eq('id', invEditingId).select();
      if (error) return setErrorModal({ isOpen: true, message: 'خطأ: ' + error.message });
      if (data && data.length > 0) setProducts(products.map(p => p.id === invEditingId ? fromDbProduct(data[0]) : p));
    }
    closeInvModal();
  };

  const confirmDelete = (id: string, type: 'inventory' | 'purchasing' | 'sales', title: string) => {
    setDeleteConfirm({ isOpen: true, id, type, title });
  };
  const executeDelete = async () => {
    if (deleteConfirm.type === 'inventory') {
      const { error } = await supabase.from('products').delete().eq('id', deleteConfirm.id);
      if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حذف المادة: ' + error.message });
      setProducts(products.filter(p => p.id !== deleteConfirm.id));
    } else if (deleteConfirm.type === 'purchasing') {
      // حذف فاتورة شراء يلغي أثرها على المخزون.
      const invoiceToDelete = purchases.find(p => p.id === deleteConfirm.id);
      if (invoiceToDelete) {
        let updatedProducts = [...products];
        for (const oldItem of invoiceToDelete.items) {
          updatedProducts = updatedProducts.map(p =>
            p.id === oldItem.productId ? { ...p, quantity: Math.max(0, p.quantity - oldItem.quantity) } : p
          );
        }
        const synced = await persistProductChanges(updatedProducts, products);
        setProducts(synced.products);
        if (synced.error) {
          return setErrorModal({ isOpen: true, message: 'تعذّر تعديل المخزون: ' + synced.error });
        }
      }
      const { error } = await supabase.from('purchases').delete().eq('id', deleteConfirm.id);
      if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حذف الفاتورة: ' + error.message });
      setPurchases(purchases.filter(p => p.id !== deleteConfirm.id));
    } else if (deleteConfirm.type === 'sales') {
      // حذف فاتورة بيع يرجّع الكميات المباعة إلى المخزن.
      const invoiceToDelete = salesInvoices.find(i => i.id === deleteConfirm.id);
      if (invoiceToDelete) {
        let restored = [...products];
        for (const soldItem of invoiceToDelete.items) {
          restored = restored.map(p =>
            p.id === soldItem.id ? { ...p, quantity: p.quantity + soldItem.cartQuantity } : p
          );
        }
        const synced = await persistProductChanges(restored, products);
        setProducts(synced.products);
        if (synced.error) {
          return setErrorModal({ isOpen: true, message: 'تعذّر إرجاع الكميات للمخزن: ' + synced.error });
        }
      }
      const { error } = await supabase.from('sales_invoices').delete().eq('id', deleteConfirm.id);
      if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حذف الفاتورة: ' + error.message });
      setSalesInvoices(salesInvoices.filter(i => i.id !== deleteConfirm.id));
    }
    setDeleteConfirm({ isOpen: false, id: '', type: 'inventory', title: '' });
  };

  const handleSaveSalesEdit = async () => {
    if (!salesEditModal.customerName.trim()) {
      return setErrorModal({ isOpen: true, message: 'يرجى إدخال اسم الزبون.' });
    }
    const { error } = await supabase
      .from('sales_invoices')
      .update({
        customer_name: salesEditModal.customerName.trim(),
        date: salesEditModal.date,
        due_date: salesEditModal.dueDate || null,
      })
      .eq('id', salesEditModal.id);

    if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ التعديل: ' + error.message });

    setSalesInvoices(salesInvoices.map(inv => inv.id === salesEditModal.id
      ? { ...inv, customerName: salesEditModal.customerName.trim(), date: salesEditModal.date, dueDate: salesEditModal.dueDate }
      : inv));
    setSalesEditModal({ ...salesEditModal, isOpen: false });
  };


  // --- Purchasing Functions ---
  const openPurModal = (type: 'add' | 'edit', invoice?: PurchaseInvoice) => {
    setPurModalType(type);
    if (type === 'edit' && invoice) {
      setPurEditingId(invoice.id);
      setPurFormData(invoice);
    } else {
      setPurEditingId(null);
      setPurFormData({ id: '', invoiceNumber: newPurchaseNumber(), supplierName: '', date: getTodayDate(), items: [], totalAmount: 0, paidAmount: 0, paymentStatus: 'paid', dueDate: '', notes: '' });
    }
    setCurrentPurItem({ name: '', quantity: 1, costPrice: 0 });
    setIsPurModalOpen(true);
  };
  const closePurModal = () => setIsPurModalOpen(false);
  
  const addPurItemToInvoice = () => {
    if (!currentPurItem.name.trim() || currentPurItem.quantity <= 0 || currentPurItem.costPrice <= 0) return setErrorModal({ isOpen: true, message: 'يرجى تحديد اسم المادة والكمية وسعر التكلفة بشكل صحيح!' });
    const existingProduct = products.find(p => p.name === currentPurItem.name.trim());
    const itemProductId = existingProduct ? existingProduct.id : newTempProductId();
    const newItem: PurchaseItem = { id: newId(), productId: itemProductId, name: currentPurItem.name.trim(), quantity: currentPurItem.quantity, costPrice: currentPurItem.costPrice, total: currentPurItem.quantity * currentPurItem.costPrice };
    const newItems = [...purFormData.items, newItem];
    setPurFormData({ ...purFormData, items: newItems, totalAmount: newItems.reduce((acc, item) => acc + item.total, 0) });
    setCurrentPurItem({ name: '', quantity: 1, costPrice: 0 });
  };
  const removePurItem = (itemId: string) => {
    const newItems = purFormData.items.filter(item => item.id !== itemId);
    setPurFormData({ ...purFormData, items: newItems, totalAmount: newItems.reduce((acc, item) => acc + item.total, 0) });
  };
  /** الفاتورة المفتوحة حالياً في نافذة الدفعات. */
  const paymentInvoice = (paymentModal.type === 'purchase' ? purchases : salesInvoices)
    .find(inv => inv.id === paymentModal.invoiceId);

  /**
   * يكتب سجل الدفعات الجديد في قاعدة البيانات ثم في الحالة.
   *
   * المبلغ المدفوع يُشتق من مجموع الدفعات بدل زيادته أو إنقاصه يدوياً،
   * حتى لا ينحرف الرقم عن السجل عند الإضافة أو الحذف. حالة السداد
   * تُعاد حسابها من الرقم الناتج.
   */
  const commitPayments = async (payments: PaymentRecord[]): Promise<boolean> => {
    const target = paymentInvoice;
    if (!target) {
      setErrorModal({ isOpen: true, message: 'لم يتم العثور على الفاتورة.' });
      return false;
    }

    const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const paymentStatus: 'paid' | 'credit' = paidAmount >= target.totalAmount ? 'paid' : 'credit';
    const table = paymentModal.type === 'purchase' ? 'purchases' : 'sales_invoices';

    const { error } = await supabase
      .from(table)
      .update({ paid_amount: paidAmount, payment_status: paymentStatus, payments })
      .eq('id', target.id);

    if (error) {
      setErrorModal({ isOpen: true, message: 'تعذّر حفظ التعديل: ' + error.message });
      return false;
    }

    if (paymentModal.type === 'purchase') {
      setPurchases(purchases.map(inv =>
        inv.id === target.id ? { ...inv, payments, paidAmount, paymentStatus } : inv));
    } else {
      setSalesInvoices(salesInvoices.map(inv =>
        inv.id === target.id ? { ...inv, payments, paidAmount, paymentStatus } : inv));
    }
    return true;
  };

  const handleSavePayment = async () => {
    if (paymentModal.amount <= 0) return setErrorModal({ isOpen: true, message: 'يرجى إدخال مبلغ صحيح.' });
    if (!paymentInvoice) return setErrorModal({ isOpen: true, message: 'لم يتم العثور على الفاتورة.' });

    const newPayment: PaymentRecord = {
      id: newId(),
      date: paymentModal.date,
      amount: paymentModal.amount,
      note: paymentModal.method,
    };

    const ok = await commitPayments([...(paymentInvoice.payments || []), newPayment]);
    if (ok) setPaymentModal({ ...paymentModal, amount: 0, method: 'نقدي' });
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!paymentInvoice) return;
    setDeletingPaymentId(paymentId);
    await commitPayments((paymentInvoice.payments || []).filter(p => p.id !== paymentId));
    setDeletingPaymentId(null);
  };

  const handlePurSave = async () => {
    if (!purFormData.supplierName) return setErrorModal({ isOpen: true, message: 'يرجى إدخال اسم المورد!' });
    if (purFormData.items.length === 0) return setErrorModal({ isOpen: true, message: 'يرجى إضافة مواد للفاتورة!' });

    const now = newId();
    let updatedProducts = [...products];

    if (purModalType === 'edit' && purEditingId) {
      // التعديل يلغي أثر الفاتورة القديمة على المخزون ثم يطبّق الجديدة.
      const oldInvoice = purchases.find(p => p.id === purEditingId);
      if (oldInvoice) {
        oldInvoice.items.forEach(oldItem => {
          updatedProducts = updatedProducts.map(p => p.id === oldItem.productId ? { ...p, quantity: Math.max(0, p.quantity - oldItem.quantity) } : p);
        });
      }
      const finalPaidAmount = purFormData.paymentStatus === 'paid' ? purFormData.totalAmount : purFormData.paidAmount;
      const initialPayments = finalPaidAmount > 0 ? [{ id: now, date: purFormData.date, amount: finalPaidAmount, note: 'دفعة أولية' }] : (purFormData.payments || []);
      const updatedInvoice = { ...purFormData, paidAmount: finalPaidAmount, payments: initialPayments };

      updatedInvoice.items.forEach(newItem => {
        if (newItem.productId.startsWith('NEW_')) {
          updatedProducts.push({ id: newItem.productId, barcode: newBarcode(), name: newItem.name, category: 'مواد مضافة تلقائياً', quantity: newItem.quantity, lowStockAlert: 5, costPrice: newItem.costPrice, price: newItem.costPrice * 1.25 });
        } else {
          updatedProducts = updatedProducts.map(p => p.id === newItem.productId ? { ...p, quantity: p.quantity + newItem.quantity } : p);
        }
      });

      const { error } = await supabase.from('purchases').update(toDbPurchase(updatedInvoice)).eq('id', purEditingId);
      if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ فاتورة الشراء: ' + error.message });
      setPurchases(purchases.map(p => p.id === purEditingId ? updatedInvoice : p));
    } else {
      const finalPaidAmount = purFormData.paymentStatus === 'paid' ? purFormData.totalAmount : purFormData.paidAmount;
      const initialPayments = finalPaidAmount > 0 ? [{ id: now, date: purFormData.date, amount: finalPaidAmount, note: 'دفعة أولية' }] : [];
      const savedInvoice = { ...purFormData, id: now, paidAmount: finalPaidAmount, payments: initialPayments };

      savedInvoice.items.forEach(purchasedItem => {
        if (purchasedItem.productId.startsWith('NEW_')) {
          updatedProducts.push({ id: purchasedItem.productId, barcode: newBarcode(), name: purchasedItem.name, category: 'مواد مضافة تلقائياً', quantity: purchasedItem.quantity, lowStockAlert: 5, costPrice: purchasedItem.costPrice, price: purchasedItem.costPrice * 1.25 });
        } else {
          updatedProducts = updatedProducts.map(p => p.id === purchasedItem.productId ? { ...p, quantity: p.quantity + purchasedItem.quantity } : p);
        }
      });

      const { data, error } = await supabase.from('purchases').insert([toDbPurchase(savedInvoice)]).select();
      if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ فاتورة الشراء: ' + error.message });
      if (data && data.length > 0) savedInvoice.id = data[0].id.toString();
      setPurchases([savedInvoice, ...purchases]);
    }

    const synced = await persistProductChanges(updatedProducts, products);
    setProducts(synced.products);
    if (synced.error) {
      setErrorModal({ isOpen: true, message: 'حُفظت الفاتورة لكن تعذّر تحديث المخزون: ' + synced.error });
    }
    closePurModal();
  };
  const openViewPurModal = (invoice: PurchaseInvoice) => { setSelectedInvoice(invoice); setIsViewPurModalOpen(true); };
  const closeViewPurModal = () => { setIsViewPurModalOpen(false); setSelectedInvoice(null); };


  // --- Sales (POS) Functions ---
  const filteredPosProducts = products.filter(p => {
    const matchCategory = activePosCategory === 'الكل' || p.category === activePosCategory;
    const matchSearch = p.name.includes(searchPos) || p.barcode.includes(searchPos);
    return matchCategory && matchSearch;
  });

  const addToCart = (product: Product) => {
    if (product.quantity <= 0) return setErrorModal({ isOpen: true, message: 'هذه المادة نفدت من المخزن!' });
    
    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) {
      if (existingItem.cartQuantity >= product.quantity) return setErrorModal({ isOpen: true, message: 'لا يمكن إضافة كمية أكبر من المتوفر!' });
      setCart(cart.map(item => item.id === product.id ? { ...item, cartQuantity: item.cartQuantity + 1, total: (item.cartQuantity + 1) * item.price } : item));
    } else {
      setCart([...cart, { ...product, cartQuantity: 1, total: product.price }]);
    }
  };

  const updateCartQty = (productId: string, delta: number) => {
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    
    const newQty = item.cartQuantity + delta;
    if (newQty <= 0) {
      setCart(cart.filter(i => i.id !== productId));
    } else {
      if (newQty > item.quantity) return setErrorModal({ isOpen: true, message: 'الكمية المطلوبة تتجاوز المتوفر!' });
      setCart(cart.map(i => i.id === productId ? { ...i, cartQuantity: newQty, total: newQty * i.price } : i));
    }
  };

  const cartSubtotal = cart.reduce((acc, item) => acc + item.total, 0);
  const cartGrandTotal = Math.max(0, cartSubtotal - discount);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setErrorModal({ isOpen: true, message: 'لا يمكن إتمام العملية. السلة فارغة، يرجى إضافة مواد أولاً!' });
      return;
    }
    if (salesPaymentStatus === 'credit' && (!customerName || customerName === 'زبون نقدي')) {
      setErrorModal({ isOpen: true, message: 'لا يمكن إتمام البيع الآجل بدون اسم. يرجى إدخال اسم الزبون!' });
      return;
    }

    // Create Invoice
    const newInvoice: SalesInvoice = {
      id: newId(),
      invoiceNumber: newInvoiceNumber(),
      customerName,
      date: getTodayDate(),
      dueDate: salesPaymentStatus === 'credit' ? salesDueDate : undefined,
      items: [...cart],
      subtotal: cartSubtotal,
      discount,
      totalAmount: cartGrandTotal,
      paidAmount: salesPaymentStatus === 'paid' ? cartGrandTotal : salesPaidAmount,
      paymentStatus: salesPaymentStatus,
      payments: (salesPaymentStatus === 'paid' ? cartGrandTotal : salesPaidAmount) > 0 ? [{ id: newId() + '1', date: getTodayDate(), amount: salesPaymentStatus === 'paid' ? cartGrandTotal : salesPaidAmount, note: 'دفعة أولية' }] : []
    };
    
    const dbInvoice = { invoice_number: newInvoice.invoiceNumber, customer_name: newInvoice.customerName, date: newInvoice.date, total_amount: newInvoice.totalAmount, paid_amount: newInvoice.paidAmount, payment_status: newInvoice.paymentStatus, due_date: newInvoice.dueDate, items: newInvoice.items, payments: newInvoice.payments };
    const { data, error } = await supabase.from('sales_invoices').insert([dbInvoice]).select();
    if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ الفاتورة: ' + error.message });
    if (data && data.length > 0) newInvoice.id = data[0].id.toString();

    setSalesInvoices([newInvoice, ...salesInvoices]);

    // Deduct from Inventory
    let updatedProducts = [...products];
    cart.forEach(cartItem => {
      updatedProducts = updatedProducts.map(p => {
        if (p.id === cartItem.id) {
          return { ...p, quantity: Math.max(0, p.quantity - cartItem.cartQuantity) };
        }
        return p;
      });
    });
    const synced = await persistProductChanges(updatedProducts, products);
    setProducts(synced.products);
    if (synced.error) {
      setErrorModal({ isOpen: true, message: 'حُفظت الفاتورة لكن تعذّر خصم المخزون: ' + synced.error });
    }

    // Reset POS
    setCart([]);
    setDiscount(0);
    setSalesPaymentStatus('paid');
    setSalesPaidAmount(0);
    setSalesDueDate('');
    setCustomerName('زبون نقدي');
    setSuccessModal({ isOpen: true, invoice: newInvoice });
  };


  // --- Production & Damages Logic ---
  const handleSaveDamage = async () => {
    if (!damageFormData.itemId || damageFormData.quantity <= 0) return setErrorModal({ isOpen: true, message: 'يرجى تحديد المادة التالفة والكمية بشكل صحيح!' });
    const product = products.find(p => p.id === damageFormData.itemId);
    if (!product || product.quantity < damageFormData.quantity) return setErrorModal({ isOpen: true, message: 'الكمية التالفة أكبر من الكمية المتوفرة في المخزن!' });

    // Deduct from inventory
    const updatedInventory = products.map(p => p.id === product.id ? { ...p, quantity: p.quantity - damageFormData.quantity } : p);

    // Create damage record
    const newDamage: DamageRecord = {
      id: newId(),
      itemId: product.id,
      itemName: product.name,
      quantity: damageFormData.quantity,
      costPrice: damageFormData.costPrice,
      totalLoss: damageFormData.quantity * damageFormData.costPrice,
      reason: damageFormData.reason,
      date: getTodayDate()
    };
    const dbDamage = { item_id: newDamage.itemId, item_name: newDamage.itemName, quantity: newDamage.quantity, cost_price: newDamage.costPrice, total_loss: newDamage.totalLoss, reason: newDamage.reason, date: newDamage.date };
    const { data, error } = await supabase.from('damages').insert([dbDamage]).select();
    if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ سجل التلف: ' + error.message });
    if (data && data.length > 0) newDamage.id = data[0].id.toString();
    setDamages([newDamage, ...damages]);

    const synced = await persistProductChanges(updatedInventory, products);
    setProducts(synced.products);
    if (synced.error) {
      setErrorModal({ isOpen: true, message: 'سُجّل التلف لكن تعذّر خصم المخزون: ' + synced.error });
    }
    setIsDamageModalOpen(false);
  };

  const addComponentToProduction = () => {
    if (!prodComponentInput.itemId || prodComponentInput.quantityUsed <= 0) return setErrorModal({ isOpen: true, message: 'يرجى تحديد المادة الأولية والكمية بشكل صحيح!' });
    const product = products.find(p => p.id === prodComponentInput.itemId);
    if (!product) return;
    setProductionFormData({
      ...productionFormData,
      components: [...productionFormData.components, { ...prodComponentInput, itemName: product.name }]
    });
    setProdComponentInput({ itemId: '', itemName: '', quantityUsed: 1, costPrice: 0 });
  };

  const removeComponentFromProduction = (itemId: string) => {
    setProductionFormData({
      ...productionFormData,
      components: productionFormData.components.filter(c => c.itemId !== itemId)
    });
  };

  const handleSaveProduction = async () => {
    if (!productionFormData.producedItemName || productionFormData.quantityProduced <= 0) return setErrorModal({ isOpen: true, message: 'يرجى إدخال اسم المنتج النهائي والكمية!' });
    if (productionFormData.components.length === 0) return setErrorModal({ isOpen: true, message: 'يجب إضافة مواد أولية لتصنيع هذا المنتج!' });

    // Check inventory for all components
    let canProduce = true;
    for (const comp of productionFormData.components) {
      const product = products.find(p => p.id === comp.itemId);
      const totalNeeded = comp.quantityUsed * productionFormData.quantityProduced;
      if (!product || product.quantity < totalNeeded) {
        setErrorModal({ isOpen: true, message: `الكمية المتوفرة من "${comp.itemName}" لا تكفي لإنتاج هذه الكمية!` });
        canProduce = false;
        break;
      }
    }
    if (!canProduce) return;

    // Deduct components from inventory
    let updatedInventory = [...products];
    let totalCost = 0;
    
    productionFormData.components.forEach(comp => {
      const totalNeeded = comp.quantityUsed * productionFormData.quantityProduced;
      totalCost += comp.costPrice * totalNeeded;
      updatedInventory = updatedInventory.map(p => p.id === comp.itemId ? { ...p, quantity: p.quantity - totalNeeded } : p);
    });

    // Add or Update the Produced Item in Inventory
    const producedItemExists = updatedInventory.find(p => p.name === productionFormData.producedItemName);
    const costPerUnit = totalCost / productionFormData.quantityProduced;

    if (producedItemExists) {
      updatedInventory = updatedInventory.map(p => p.id === producedItemExists.id ? { ...p, quantity: p.quantity + productionFormData.quantityProduced } : p);
    } else {
      // معرّف مؤقت؛ يُستبدل بالمعرّف الحقيقي بعد الإدراج في قاعدة البيانات.
      updatedInventory.push({
        id: newTempProducedId(),
        barcode: newProductionBarcode(),
        name: productionFormData.producedItemName,
        category: productionFormData.category,
        quantity: productionFormData.quantityProduced,
        lowStockAlert: 5,
        costPrice: costPerUnit,
        price: costPerUnit * 1.25 // Default 25% margin
      });
    }

    // نزامن المخزون أولاً حتى يحصل المنتج الجديد على معرّفه الحقيقي
    // قبل أن نربطه بسجل الإنتاج.
    const synced = await persistProductChanges(updatedInventory, products);
    setProducts(synced.products);
    if (synced.error) {
      return setErrorModal({ isOpen: true, message: 'تعذّر تحديث المخزون: ' + synced.error });
    }

    const producedItemId = producedItemExists
      ? producedItemExists.id
      : synced.products.find(p => p.name === productionFormData.producedItemName)?.id ?? '';

    // Create production record
    const newProduction: ProductionRecord = {
      id: newId(),
      producedItemId,
      producedItemName: productionFormData.producedItemName,
      quantityProduced: productionFormData.quantityProduced,
      totalCost,
      components: productionFormData.components,
      date: getTodayDate()
    };
    const dbProd = { produced_item_id: newProduction.producedItemId, produced_item_name: newProduction.producedItemName, quantity_produced: newProduction.quantityProduced, total_cost: newProduction.totalCost, components: newProduction.components, date: newProduction.date };
    const { data, error } = await supabase.from('productions').insert([dbProd]).select();
    if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ سجل الإنتاج: ' + error.message });
    if (data && data.length > 0) newProduction.id = data[0].id.toString();
    setProductions([newProduction, ...productions]);
    setIsProductionModalOpen(false);
  };

  // --- Maintenance Logic ---
  const openMaintenanceModal = (type: 'add' | 'edit', ticket?: MaintenanceTicket) => {
    setMaintenanceModalType(type);
    if (type === 'edit' && ticket) {
      setMaintenanceFormData(ticket);
    } else {
      setMaintenanceFormData({
        id: '', ticketNumber: newTicketNumber(), customerName: '', customerPhone: '', deviceType: '', issueDescription: '', status: 'pending', usedParts: [], estimatedCost: 0, deposit: 0, warrantyPeriod: 'بدون ضمان', receiveDate: getTodayDate()
      });
    }
    setPartInput({ itemId: '', itemName: '', quantity: 1, costPrice: 0, sellPrice: 0 });
    setIsMaintenanceModalOpen(true);
  };

  const addPartToMaintenance = () => {
    if (!partInput.itemId || partInput.quantity <= 0) return setErrorModal({ isOpen: true, message: 'يرجى تحديد قطعة الغيار والكمية بشكل صحيح!' });
    const product = products.find(p => p.id === partInput.itemId);
    if (!product || product.quantity < partInput.quantity) return setErrorModal({ isOpen: true, message: 'الكمية المطلوبة لقطعة الغيار غير متوفرة في المخزن!' });
    
    setMaintenanceFormData({
      ...maintenanceFormData,
      usedParts: [...maintenanceFormData.usedParts, { ...partInput, itemName: product.name, costPrice: product.price / 1.25, sellPrice: product.price }]
    });
    setPartInput({ itemId: '', itemName: '', quantity: 1, costPrice: 0, sellPrice: 0 });
  };

  const removePartFromMaintenance = (itemId: string) => {
    setMaintenanceFormData({
      ...maintenanceFormData,
      usedParts: maintenanceFormData.usedParts.filter(p => p.itemId !== itemId)
    });
  };

  const handleSaveMaintenanceTicket = async () => {
    if (!maintenanceFormData.customerName || !maintenanceFormData.deviceType) return setErrorModal({ isOpen: true, message: 'يرجى إدخال اسم الزبون ونوع الجهاز!' });

    let updatedProducts = [...products];
    if (maintenanceModalType === 'add') {
       maintenanceFormData.usedParts.forEach(part => {
         updatedProducts = updatedProducts.map(p => p.id === part.itemId ? { ...p, quantity: p.quantity - part.quantity } : p);
       });

       const newTicket = { ...maintenanceFormData, id: newId() };
       const { data, error } = await supabase.from('maintenance_tickets').insert([toDbMaintenance(newTicket)]).select();
       if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ تذكرة الصيانة: ' + error.message });
       if (data && data.length > 0) newTicket.id = data[0].id.toString();
       setMaintenanceTickets([newTicket, ...maintenanceTickets]);
    } else {
       // التعديل يرجّع القطع القديمة للمخزن ثم يخصم القطع الجديدة.
       const originalTicket = maintenanceTickets.find(t => t.id === maintenanceFormData.id);
       if (originalTicket) {
         originalTicket.usedParts.forEach(part => {
           updatedProducts = updatedProducts.map(p => p.id === part.itemId ? { ...p, quantity: p.quantity + part.quantity } : p);
         });
         maintenanceFormData.usedParts.forEach(part => {
           updatedProducts = updatedProducts.map(p => p.id === part.itemId ? { ...p, quantity: p.quantity - part.quantity } : p);
         });
       }
       const { error } = await supabase.from('maintenance_tickets').update(toDbMaintenance(maintenanceFormData)).eq('id', maintenanceFormData.id);
       if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ تذكرة الصيانة: ' + error.message });
       setMaintenanceTickets(maintenanceTickets.map(t => t.id === maintenanceFormData.id ? maintenanceFormData : t));
    }

    const synced = await persistProductChanges(updatedProducts, products);
    setProducts(synced.products);
    if (synced.error) {
      setErrorModal({ isOpen: true, message: 'حُفظت التذكرة لكن تعذّر تحديث المخزون: ' + synced.error });
    }
    setIsMaintenanceModalOpen(false);
  };

  const deliverMaintenanceTicket = async (ticket: MaintenanceTicket) => {
    if (ticket.status === 'completed' || ticket.status === 'rejected') return;
    
    const updatedTicket = { ...ticket, status: 'completed' as MaintenanceStatus, deliveryDate: getTodayDate() };
    const { error: ticketError } = await supabase.from('maintenance_tickets').update({ status: updatedTicket.status }).eq('id', ticket.id);
    if (ticketError) return setErrorModal({ isOpen: true, message: 'تعذّر تحديث حالة التذكرة: ' + ticketError.message });
    setMaintenanceTickets(maintenanceTickets.map(t => t.id === ticket.id ? updatedTicket : t));

    const remainingAmount = ticket.estimatedCost - ticket.deposit;
    if (remainingAmount > 0) {
      const newInvoice: SalesInvoice = {
        id: newId(),
        invoiceNumber: newInvoiceNumber(),
        customerName: ticket.customerName,
        date: getTodayDate(),
        items: [{
          id: `MN-${ticket.id}`, barcode: 'MAINT', name: `أجور صيانة وقطع غيار - ${ticket.deviceType}`, category: 'صيانة', costPrice: 0, price: remainingAmount, quantity: 1, lowStockAlert: 0, cartQuantity: 1, total: remainingAmount
        }],
        subtotal: remainingAmount,
        discount: 0,
        totalAmount: remainingAmount,
        paidAmount: remainingAmount,
        paymentStatus: 'paid'
      };
      const dbInvoice = { invoice_number: newInvoice.invoiceNumber, customer_name: newInvoice.customerName, date: newInvoice.date, total_amount: newInvoice.totalAmount, paid_amount: newInvoice.paidAmount, payment_status: newInvoice.paymentStatus, due_date: newInvoice.dueDate, items: newInvoice.items, payments: [] };
      const { data } = await supabase.from('sales_invoices').insert([dbInvoice]).select();
      if (data && data.length > 0) newInvoice.id = data[0].id.toString();
      setSalesInvoices([newInvoice, ...salesInvoices]);
    }
  };


  const exportTableToWord = (tableId: string, filename: string) => {
    const table = document.getElementById(tableId) as HTMLTableElement;
    if (!table) return;

    // Build a clean table from the data - no web CSS classes
    const rows = Array.from(table.querySelectorAll('tr'));
    let cleanRows = '';

    rows.forEach((row) => {
      const isHeaderRow = row.querySelector('th') !== null;
      const cells = Array.from(row.querySelectorAll('th, td'));
      let cleanCells = '';

      cells.forEach((cell) => {
        const text = (cell as HTMLElement).innerText.trim();
        // Skip the "إجراءات" column
        if (text === 'إجراءات' || text.includes('إجراءات')) {
          return; // skip this cell
        }
        // Skip cells that contain only icon buttons (edit/delete)
        if (cell.querySelector('.btn-icon, .btn-edit, .btn-delete, .action-btns')) {
          return;
        }

        if (isHeaderRow) {
          cleanCells += `<th style="border:1px solid #000;padding:8px;text-align:center;background:#4f46e5;color:white;font-weight:bold;">${text}</th>`;
        } else {
          cleanCells += `<td style="border:1px solid #000;padding:8px;text-align:center;">${text}</td>`;
        }
      });

      if (cleanCells) {
        cleanRows += `<tr>${cleanCells}</tr>\n`;
      }
    });

    const htmlString = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>${filename}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page { size: 21cm 29.7cm; margin: 2cm; }
body { font-family: Arial, sans-serif; direction: rtl; }
table { width: 100%; border-collapse: collapse; direction: rtl; }
th { border: 1px solid #000; padding: 8px; text-align: center; background: #4f46e5; color: white; font-weight: bold; }
td { border: 1px solid #000; padding: 8px; text-align: center; }
h2 { text-align: center; }
p { text-align: center; color: #666; }
</style>
</head>
<body>
<h2>${filename}</h2>
<p>تاريخ التصدير: ${new Date().toLocaleDateString('ar-IQ')}</p>
<table>
${cleanRows}
</table>
</body>
</html>`;

    const blob = new Blob(['\ufeff', htmlString], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // AuthGate يلتقط تغيّر الجلسة ويعيد عرض شاشة الدخول تلقائياً.
  };

  const handleBackup = async () => {
    try {
      const backupData: Record<string, unknown[]> = {};
      const tables = ['categories', 'products', 'sales_invoices', 'purchases', 'expenses', 'maintenance_tickets', 'damages', 'productions'];
      for (const table of tables) {
        const { data } = await supabase.from(table).select('*');
        backupData[table] = data || [];
      }
      
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `erp_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setErrorModal({ isOpen: true, message: 'حدث خطأ أثناء أخذ النسخة الاحتياطية.' });
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <i className="fa-solid fa-layer-group"></i>
          <span>نظام ERP</span>
        </div>
        <ul className="nav-links">
          <li>
            <a className={`nav-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => setActiveTab('sales')}>
              <i className="fa-solid fa-cash-register"></i> إدارة المبيعات (POS)
            </a>
          </li>
          <li>
            <a className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}>
              <i className="fa-solid fa-box-open"></i> إدارة المخازن
            </a>
          </li>
          <li>
            <a className={`nav-item ${activeTab === 'purchasing' ? 'active' : ''}`} onClick={() => setActiveTab('purchasing')}>
              <i className="fa-solid fa-cart-shopping"></i> إدارة المشتريات
            </a>
          </li>
          <li>
            <a className={`nav-item ${activeTab === 'production' ? 'active' : ''}`} onClick={() => setActiveTab('production')}>
              <i className="fa-solid fa-industry"></i> الإنتاج والتلفيات
            </a>
          </li>
          <li>
            <a className={`nav-item ${activeTab === 'maintenance' ? 'active' : ''}`} onClick={() => setActiveTab('maintenance')}>
              <i className="fa-solid fa-screwdriver-wrench"></i> إدارة الصيانة
            </a>
          </li>
          <li>
            <a className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
              <i className="fa-solid fa-chart-line"></i> التقارير والإحصائيات
            </a>
          </li>
          <li style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <a className="nav-item" style={{ background: 'var(--success-color)', color: 'white', justifyContent: 'center' }} onClick={handleBackup}>
              <i className="fa-solid fa-database"></i> نسخ احتياطي
            </a>
          </li>
          <li style={{ paddingTop: '8px' }}>
            <a className="nav-item" style={{ justifyContent: 'center', color: 'var(--danger-color)' }} onClick={handleLogout}>
              <i className="fa-solid fa-right-from-bracket"></i> تسجيل الخروج
            </a>
          </li>
        </ul>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* ================= SALES (POS) TAB ================= */}
        {activeTab === 'sales' && (
          <div className="animated">
            <header className="header" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <h1 className="header-title"><i className="fa-solid fa-cash-register"></i> نقطة البيع (الكاشير)</h1>
              <div className="header-actions">
                <button className="btn btn-secondary" onClick={() => setIsDailyStatsOpen(true)}>
                  <i className="fa-solid fa-chart-pie"></i> إحصائيات اليوم
                </button>
              </div>
            </header>

            <div className="pos-container">
              
              {/* Left Side: Product Selection */}
              <div className="pos-products">
                {/* Search & Categories */}

                
                {/* Search & Categories Container */}
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div className="pos-search-wrapper" style={{ flex: 1, marginBottom: 0 }}>
                    <i className="fa-solid fa-barcode pos-search-icon"></i>
                    <input 
                      type="text" 
                      className="pos-search-input" 
                      placeholder="ابحث بالاسم أو الباركود... (القارئ جاهز)" 
                      value={searchPos}
                      onChange={(e) => setSearchPos(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && searchPos.trim() !== '') {
                          const exactMatch = products.find(p => p.barcode === searchPos.trim());
                          if (exactMatch) {
                            addToCart(exactMatch);
                            setSearchPos('');
                          }
                        }
                      }}
                      autoFocus
                    />
                  </div>

                  {/* Dropdown Filter */}
                  <div className="pos-filter-dropdown">
                    <button className="pos-filter-btn" onClick={() => setIsCatDropdownOpen(!isCatDropdownOpen)}>
                      <i className="fa-solid fa-filter"></i> 
                      {activePosCategory === 'الكل' ? 'التصنيفات' : activePosCategory}
                      <i className={`fa-solid fa-chevron-${isCatDropdownOpen ? 'up' : 'down'}`} style={{ fontSize: '12px', opacity: 0.7 }}></i>
                    </button>
                    
                    {isCatDropdownOpen && (
                      <div className="pos-filter-menu">
                        <input 
                          type="text" 
                          className="pos-filter-search" 
                          placeholder="ابحث عن تصنيف..." 
                          value={catSearch}
                          onChange={(e) => setCatSearch(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div 
                          className={`pos-filter-item ${activePosCategory === 'الكل' ? 'active' : ''}`}
                          onClick={() => { setActivePosCategory('الكل'); setIsCatDropdownOpen(false); setCatSearch(''); }}
                        >
                          <i className="fa-solid fa-layer-group"></i> الكل
                        </div>
                        {categories.filter(c => c.toLowerCase().includes(catSearch.toLowerCase())).map(cat => (
                          <div 
                            key={cat} 
                            className={`pos-filter-item ${activePosCategory === cat ? 'active' : ''}`}
                            onClick={() => { setActivePosCategory(cat); setIsCatDropdownOpen(false); setCatSearch(''); }}
                          >
                            <i className="fa-solid fa-tag"></i> {cat}
                          </div>
                        ))}
                        {categories.filter(c => c.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                          <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>لا يوجد تصنيف مطابق</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Close Dropdown when clicking outside (overlay trick) */}
                {isCatDropdownOpen && (
                  <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} onClick={() => setIsCatDropdownOpen(false)}></div>
                )}
                

                {/* Product Grid */}
                <div className="pos-product-grid">
                  {filteredPosProducts.map(p => (
                    <div key={p.id} className={`pos-product-card ${p.quantity === 0 ? 'disabled' : ''}`} onClick={() => addToCart(p)}>
                      <span className={`pos-card-stock ${p.quantity <= p.lowStockAlert ? 'low' : ''}`} title="الكمية المتوفرة">
                        {p.quantity}
                      </span>
                      <div className={`pos-card-media ${p.imageUrl ? 'has-img' : ''}`}>
                        {p.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element -- static export + images.unoptimized، فـ next/image بلا فائدة هنا
                          ? <img src={p.imageUrl} alt={p.name} loading="lazy" />
                          : <i className="fa-solid fa-box-open"></i>}
                      </div>
                      <span className="pos-card-name">{p.name}</span>
                      <span className="pos-card-price">
                        {p.price.toLocaleString()} <small>د.ع</small>
                      </span>
                    </div>
                  ))}
                  {filteredPosProducts.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: '#94a3b8', fontSize: '18px' }}><i className="fa-solid fa-ghost" style={{fontSize:'40px', marginBottom:'16px', display:'block', opacity:0.5}}></i> لا توجد مواد مطابقة للبحث.</div>}
                </div>
              </div>

              {/* Right Side: Cart / Checkout */}
              <div className="pos-cart">
                <h2 style={{ fontSize: '18px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>الفاتورة الحالية</span>
                  <span className="badge badge-primary">{cart.length} مواد</span>
                </h2>

                <div className="cart-items">
                  {cart.map(item => (
                    <div className="cart-item" key={item.id}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{item.name}</div>
                        <div style={{ color: 'var(--success-color)', fontSize: '13px' }}>{item.price.toLocaleString()} د.ع</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="cart-qty-btn" onClick={() => updateCartQty(item.id, 1)}><i className="fa-solid fa-plus" style={{ fontSize: '10px' }}></i></button>
                        <span style={{ fontWeight: 'bold', width: '20px', textAlign: 'center' }}>{item.cartQuantity}</span>
                        <button className="cart-qty-btn" onClick={() => updateCartQty(item.id, -1)}><i className="fa-solid fa-minus" style={{ fontSize: '10px' }}></i></button>
                      </div>
                      <div style={{ width: '80px', textAlign: 'left', fontWeight: 'bold' }}>
                        {item.total.toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {cart.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>السلة فارغة، ابدأ بإضافة المواد!</div>}
                </div>

                <div className="cart-totals">
                  <div className="cart-totals-row">
                    <span>المجموع (قبل الخصم):</span>
                    <span>{cartSubtotal.toLocaleString()} د.ع</span>
                  </div>
                  <div className="cart-totals-row" style={{ alignItems: 'center' }}>
                    <span>الخصم (إن وجد):</span>
                    <input 
                      type="number" 
                      min="0" 
                      value={discount || ''} 
                      onChange={(e) => setDiscount(Number(e.target.value))} 
                      className="glass-input"
                      style={{ width: '75px', padding: '4px 8px', fontSize: '13px', textAlign: 'center', height: '30px' }} 
                      placeholder="0" 
                    />
                  </div>
                  <div className="cart-totals-row grand-total">
                    <span>الصافي (دينار):</span>
                    <span>{cartGrandTotal.toLocaleString()} د.ع</span>
                  </div>
                  <div className="cart-totals-row" style={{ color: '#fbbf24', marginTop: '4px', fontSize: '13px' }}>
                    <span>المعادل بالدولار (تقريبي):</span>
                    <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>$ {(cartGrandTotal / EXCHANGE_RATE).toFixed(2)}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#94a3b8' }}>طريقة الدفع</label>
                    <select 
                      value={salesPaymentStatus} 
                      onChange={(e) => setSalesPaymentStatus(e.target.value as 'paid' | 'credit')} 
                      className="glass-input"
                      style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                    >
                      <option value="paid" style={{ color: 'black' }}>نقدي (كاش)</option>
                      <option value="credit" style={{ color: 'black' }}>آجل (دفع جزئي أو آجل)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#94a3b8' }}>اسم الزبون</label>
                    <input 
                      type="text" 
                      value={customerName} 
                      onChange={(e) => setCustomerName(e.target.value)} 
                      className="glass-input"
                      style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                    />
                  </div>
                  {salesPaymentStatus === 'credit' && (
                    <>
                      <div>
                        <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#94a3b8' }}>المبلغ المستلم</label>
                        <input 
                          type="number" 
                          min="0"
                          value={salesPaidAmount} 
                          onChange={(e) => setSalesPaidAmount(Number(e.target.value))} 
                          className="glass-input"
                          style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#94a3b8' }}>تاريخ الاستحقاق (التسديد)</label>
                        <input 
                          type="date" 
                          value={salesDueDate} 
                          onChange={(e) => setSalesDueDate(e.target.value)} 
                          className="glass-input"
                          style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                        />
                      </div>
                    </>
                  )}
                </div>

                <button 
                  className="btn btn-save" 
                  style={{ width: '100%', padding: '16px', fontSize: '18px', fontWeight: 'bold', display: 'flex', justifyContent: 'center', gap: '12px' }}
                  onClick={handleCheckout}
                >
                  <i className="fa-solid fa-print"></i> دفع وإصدار الفاتورة
                </button>

              </div>
            </div>
          </div>
        )}

        {/* ================= INVENTORY TAB (Omitted structural changes) ================= */}
        {activeTab === 'inventory' && (
          <div className="animated">
            <header className="header">
              <h1 className="header-title">إدارة المخازن</h1>
              <div className="header-actions">
                <button className="btn btn-secondary" onClick={() => exportTableToWord('inventory-table', 'المخازن')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button>
                <button className="btn btn-primary" onClick={() => openInvModal('add')}>
                  <i className="fa-solid fa-plus"></i> إضافة مادة جديدة
                </button>
              </div>
            </header>
            <div className="search-bar">
              <input type="text" className="glass-input" placeholder="ابحث عن مادة..." />
            </div>
            <div className="table-container">
              <table className="glass-table" id="inventory-table">
                <thead>
                  <tr>
                    <th>الباركود</th>
                    <th>اسم المادة</th>
                    <th>التصنيف</th>
                    <th>العدد المتوفر</th>
                    <th>حد التنبيه</th>
                    <th>الحالة</th>
                    <th>السعر</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.barcode}</strong></td>
                      <td>{p.name}</td>
                      <td>{p.category}</td>
                      <td style={{ color: p.quantity === 0 ? '#ef4444' : p.quantity <= p.lowStockAlert ? '#fbbf24' : 'inherit', fontWeight: 'bold' }}>{p.quantity}</td>
                      <td>{p.lowStockAlert}</td>
                      <td>{getStockStatus(p.quantity, p.lowStockAlert)}</td>
                      <td>{p.price.toLocaleString()} د.ع</td>
                      <td>
                        <div className="action-btns">
                          <button className="btn-icon btn-edit" onClick={() => openInvModal('edit', p)} title="تعديل"><i className="fa-solid fa-pen"></i></button>
                          <button className="btn-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)' }} onClick={() => setBarcodeModal({ isOpen: true, product: p })} title="طباعة باركود"><i className="fa-solid fa-barcode"></i></button>
                          <button className="btn-icon btn-delete" onClick={() => confirmDelete(p.id, 'inventory', p.name)} title="حذف"><i className="fa-solid fa-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= PURCHASING TAB (Omitted structural changes) ================= */}
        {activeTab === 'purchasing' && (
          <div className="animated">
            <header className="header" style={{ marginBottom: '24px' }}>
              <h1 className="header-title">إدارة المشتريات (الموردين)</h1>
              <div className="header-actions">
                <button className="btn btn-primary" onClick={() => openPurModal('add')}>
                  <i className="fa-solid fa-file-invoice"></i> إضافة فاتورة مشتريات
                </button>
              </div>
            </header>

            <div className="dashboard-grid" style={{ marginBottom: '32px' }}>
              <div className="glass-card stat-card">
                <span className="stat-title">إجمالي المشتريات (هذا الشهر)</span>
                <span className="stat-value">{purchases.reduce((acc, p) => acc + p.totalAmount, 0).toLocaleString()} د.ع</span>
                <span className="stat-change positive"><i className="fa-solid fa-chart-line"></i> إجمالي البضاعة المضافة</span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-title">الديون المستحقة (الآجل)</span>
                <span className="stat-value" style={{ color: '#fbbf24' }}>
                  {purchases.filter(p => p.paymentStatus === 'credit').reduce((acc, p) => acc + (p.totalAmount - (p.paidAmount || 0)), 0).toLocaleString()} د.ع
                </span>
                <span className="stat-change negative"><i className="fa-solid fa-clock"></i> ديون مطلوبة للموردين</span>
              </div>
            </div>

            <div className="table-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 className="section-title" style={{ margin: 0 }}>فواتير المشتريات الأخيرة</h2><button className="btn btn-secondary" onClick={() => exportTableToWord('purchases-table', 'سجل المشتريات')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button></div>
              <table className="glass-table" id="purchases-table">
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>اسم المورد / الشركة</th>
                    <th>التاريخ</th>
                    <th>تاريخ التسديد</th>
                    <th>المواد المشتراة</th>
                    <th>المبلغ الإجمالي</th>
                    <th>حالة الدفع</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.invoiceNumber}</strong></td>
                      <td>{p.supplierName}</td>
                      <td>{p.date}</td>
                      <td style={{ color: 'var(--warning-color)' }}>{p.dueDate || '-'}</td>
                      <td style={{ fontSize: '11px', maxWidth: '200px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{p.items.length} مواد:</div>
                        <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.items.map(item => `${item.name} (${item.quantity})`).join('، ')}
                        </div>
                      </td>
                      <td>
                        <strong>{p.totalAmount.toLocaleString()} د.ع</strong>
                        {p.paymentStatus === 'credit' && (
                          <div style={{ fontSize: '11px', color: 'var(--warning-color)', marginTop: '4px' }}>
                            واصل: {(p.paidAmount || 0).toLocaleString()} | باقي: {(p.totalAmount - (p.paidAmount || 0)).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td>
                        {p.paymentStatus === 'paid' ? <span className="badge badge-success">مدفوع نقداً</span> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                            <span className="badge badge-warning">آجل (باقي)</span>
                            <button className="btn btn-primary" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => setPaymentModal({ isOpen: true, type: 'purchase', invoiceId: p.id, amount: 0, date: getTodayDate(), method: 'نقدي' })}>
                              <i className="fa-solid fa-hand-holding-dollar"></i> تسديد
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="action-btns" style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => openViewPurModal(p)}>
                            <i className="fa-solid fa-eye"></i> 
                          </button>
                          <button className="btn-icon btn-edit" style={{ padding: '6px 10px' }} onClick={() => openPurModal('edit', p)}>
                            <i className="fa-solid fa-pen"></i>
                          </button>
                          <button className="btn-icon btn-delete" style={{ padding: '6px 10px' }} onClick={() => confirmDelete(p.id, 'purchasing', p.invoiceNumber)}>
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {purchases.length === 0 && <tr><td colSpan={7} style={{textAlign:'center'}}>لا توجد فواتير مشتريات.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= PRODUCTION & DAMAGES TAB ================= */}
        {activeTab === 'production' && (
          <div className="tab-content animated" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            
            {/* Damages Section */}
            <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><i className="fa-solid fa-trash text-danger"></i> سجل التلفيات (الخسائر)</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>إدارة المواد التالفة وحساب الخسائر</p>
                </div>
                <button className="btn btn-primary" style={{ background: 'var(--danger-color)' }} onClick={() => {
                  setDamageFormData({ itemId: '', itemName: '', quantity: 1, reason: 'سوء خزن', costPrice: 0 });
                  setIsDamageModalOpen(true);
                }}>
                  <i className="fa-solid fa-plus"></i> تسجيل تلف
                </button>
              </div>

              <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr', marginBottom: '20px' }}>
                <div className="glass-card stat-card" style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)' }}>
                  <span className="stat-title">إجمالي الخسائر المادية (التلفيات)</span>
                  <span className="stat-value" style={{ color: 'var(--danger-color)' }}>{damages.reduce((sum, d) => sum + d.totalLoss, 0).toLocaleString()} د.ع</span>
                  <span className="stat-change negative"><i className="fa-solid fa-arrow-trend-down"></i> {damages.length} عملية تلف مسجلة</span>
                </div>
              </div>

              <div className="table-responsive" style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}><h3 style={{ margin: 0 }}>سجل التوالف</h3><button className="btn btn-secondary" onClick={() => exportTableToWord('damages-table', 'سجل التوالف')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button></div>
                <table className="glass-table" id="damages-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المادة</th>
                      <th>الكمية</th>
                      <th>السبب</th>
                      <th>قيمة الخسارة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {damages.map(d => (
                      <tr key={d.id}>
                        <td>{d.date}</td>
                        <td>{d.itemName}</td>
                        <td style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>-{d.quantity}</td>
                        <td>{d.reason}</td>
                        <td style={{ fontWeight: 'bold' }}>{d.totalLoss.toLocaleString()} د.ع</td>
                      </tr>
                    ))}
                    {damages.length === 0 && <tr><td colSpan={5} style={{textAlign:'center', padding: '30px', color: 'var(--text-secondary)'}}>لا توجد تلفيات مسجلة. (الحمد لله)</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Production Section */}
            <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><i className="fa-solid fa-industry text-primary"></i> إدارة الإنتاج والتجميع</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>تحويل المواد الأولية إلى منتج نهائي</p>
                </div>
                <button className="btn btn-primary" onClick={() => {
                  setProductionFormData({ producedItemName: '', category: categories[0] || 'عام', quantityProduced: 1, components: [] });
                  setProdComponentInput({ itemId: '', itemName: '', quantityUsed: 1, costPrice: 0 });
                  setIsProductionModalOpen(true);
                }}>
                  <i className="fa-solid fa-boxes-packing"></i> إنتاج / تجميع جديد
                </button>
              </div>

              <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr', marginBottom: '20px' }}>
                <div className="glass-card stat-card" style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.1)' }}>
                  <span className="stat-title">إجمالي تكلفة الإنتاج الكلية</span>
                  <span className="stat-value" style={{ color: 'var(--primary-color)' }}>{productions.reduce((sum, p) => sum + p.totalCost, 0).toLocaleString()} د.ع</span>
                  <span className="stat-change positive"><i className="fa-solid fa-arrow-trend-up"></i> {productions.length} عملية إنتاج</span>
                </div>
              </div>

              <div className="table-responsive" style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}><h3 style={{ margin: 0 }}>سجل الإنتاج</h3><button className="btn btn-secondary" onClick={() => exportTableToWord('production-table', 'سجل الإنتاج')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button></div>
                <table className="glass-table" id="production-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المنتج النهائي</th>
                      <th>الكمية المنتجة</th>
                      <th>التكلفة الكلية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productions.map(p => (
                      <tr key={p.id}>
                        <td>{p.date}</td>
                        <td><strong>{p.producedItemName}</strong></td>
                        <td style={{ color: 'var(--success-color)', fontWeight: 'bold' }}>+{p.quantityProduced}</td>
                        <td style={{ fontWeight: 'bold' }}>{p.totalCost.toLocaleString()} د.ع</td>
                      </tr>
                    ))}
                    {productions.length === 0 && <tr><td colSpan={4} style={{textAlign:'center', padding: '30px', color: 'var(--text-secondary)'}}>لم يتم إنتاج أي منتجات بعد.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ================= MAINTENANCE TAB ================= */}
        {activeTab === 'maintenance' && (
          <div className="tab-content animated">
            <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2><i className="fa-solid fa-screwdriver-wrench text-primary"></i> إدارة الصيانة والورشة</h2>
                <p style={{ color: 'var(--text-secondary)' }}>تتبع الأجهزة، قطع الغيار، وتسليم الزبائن</p>
              </div>
              <button className="btn btn-primary" onClick={() => openMaintenanceModal('add')}>
                <i className="fa-solid fa-plus"></i> استلام جهاز جديد
              </button>
            </div>

            <div className="dashboard-grid" style={{ marginBottom: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="glass-card stat-card">
                <span className="stat-title">قيد الفحص / الانتظار</span>
                <span className="stat-value text-warning">{maintenanceTickets.filter(t => t.status === 'pending').length}</span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-title">قيد العمل حالياً</span>
                <span className="stat-value text-primary">{maintenanceTickets.filter(t => t.status === 'in_progress').length}</span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-title">بانتظار قطع غيار</span>
                <span className="stat-value text-danger">{maintenanceTickets.filter(t => t.status === 'waiting_parts').length}</span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-title">أجهزة جاهزة للتسليم</span>
                <span className="stat-value text-success">{maintenanceTickets.filter(t => t.status === 'completed').length}</span>
              </div>
            </div>

            <div className="glass-card table-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}><h3 style={{ margin: 0 }}>سجلات الصيانة</h3><button className="btn btn-secondary" onClick={() => exportTableToWord('maintenance-table', 'سجلات الصيانة')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button></div>
              <table className="glass-table" id="maintenance-table">
                <thead>
                  <tr>
                    <th>رقم الوصل</th>
                    <th>تاريخ الاستلام</th>
                    <th>اسم الزبون</th>
                    <th>الجهاز والعطل</th>
                    <th>الحالة</th>
                    <th>التكلفة (المتبقي)</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceTickets.map(t => (
                    <tr key={t.id}>
                      <td><span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{t.ticketNumber}</span></td>
                      <td>{t.receiveDate}</td>
                      <td>
                        <strong>{t.customerName}</strong>
                        <br/><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{t.customerPhone}</span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{t.deviceType}</span>
                        <br/><span style={{ fontSize: '12px' }}>{t.issueDescription}</span>
                      </td>
                      <td>
                        {t.status === 'pending' && <span className="badge badge-warning">قيد الانتظار</span>}
                        {t.status === 'in_progress' && <span className="badge badge-primary">قيد العمل</span>}
                        {t.status === 'waiting_parts' && <span className="badge badge-danger">بانتظار قطع</span>}
                        {t.status === 'completed' && <span className="badge badge-success">جاهز / تم التسليم</span>}
                        {t.status === 'rejected' && <span className="badge" style={{ background: '#555' }}>مرفوض</span>}
                      </td>
                      <td>
                        {t.estimatedCost.toLocaleString()} د.ع
                        <br/>
                        <span style={{ fontSize: '12px', color: t.estimatedCost - t.deposit > 0 ? 'var(--warning-color)' : 'var(--success-color)' }}>
                          باقي: {(t.estimatedCost - t.deposit).toLocaleString()}
                        </span>
                      </td>
                      <td>
                        <div className="action-btns" style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn-icon btn-edit" title="تعديل التفاصيل / سحب قطع غيار" onClick={() => openMaintenanceModal('edit', t)}>
                            <i className="fa-solid fa-pen"></i>
                          </button>
                          {(t.status !== 'completed' && t.status !== 'rejected') && (
                            <button className="btn btn-save" style={{ padding: '6px 12px', fontSize: '13px' }} title="تسليم الجهاز للزبون وإصدار فاتورة" onClick={() => deliverMaintenanceTicket(t)}>
                              <i className="fa-solid fa-check-double"></i> تسليم
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {maintenanceTickets.length === 0 && <tr><td colSpan={7} style={{textAlign:'center', padding: '30px', color: 'var(--text-secondary)'}}>لا توجد تذاكر صيانة حالياً.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= REPORTS & STATISTICS TAB ================= */}
        {activeTab === 'reports' && (
          <div className="tab-content animated">
            <div className="dashboard-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2><i className="fa-solid fa-chart-line text-primary"></i> التقارير والإحصائيات الشاملة</h2>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>تصفية حسب التاريخ:</span>
                <input type="date" className="glass-input" style={{ padding: '6px' }} value={reportFilter.startDate} onChange={e => setReportFilter({...reportFilter, startDate: e.target.value})} title="من تاريخ" />
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>إلى</span>
                <input type="date" className="glass-input" style={{ padding: '6px' }} value={reportFilter.endDate} onChange={e => setReportFilter({...reportFilter, endDate: e.target.value})} title="إلى تاريخ" />
                <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => setReportFilter({startDate: '', endDate: ''})} title="إلغاء الفلتر"><i className="fa-solid fa-filter-circle-xmark"></i></button>
              </div>
            </div>

            {(() => {
              const isDateInRange = (dateStr: string) => {
                if (!reportFilter.startDate && !reportFilter.endDate) return true;
                if (reportFilter.startDate && dateStr < reportFilter.startDate) return false;
                if (reportFilter.endDate && dateStr > reportFilter.endDate) return false;
                return true;
              };

              const filteredSales = salesInvoices.filter(i => isDateInRange(i.date));
              // المشتريات لا تُفلتر بتاريخ الفاتورة: النقد يُنسب لتاريخ الدفعة
              // نفسها، وذلك يتم داخل cashMovedInRange أدناه.
              const filteredExpenses = expenses.filter(i => isDateInRange(i.date));
              const filteredDamages = damages.filter(i => isDateInRange(i.date));
              const filteredMaintenance = maintenanceTickets.filter(i => isDateInRange(i.receiveDate));

              /**
                 مجموع ما تحرّك فعلاً من نقد خلال الفترة.

                 يُحسب من سجل الدفعات وحده — لا من paidAmount — لأن paidAmount
                 هو مجموع الدفعات أصلاً، فجمعه مع الدفعات يحتسبها مرتين.

                 والمرور على كل الفواتير لا على المفلترة بتاريخها مقصود: الدفعة
                 تُنسب لتاريخ سدادها لا لتاريخ الفاتورة، وإلا اختفت دفعة آب على
                 فاتورة تموز من تقرير آب.
               */
              const cashMovedInRange = (invoices: (PurchaseInvoice | SalesInvoice)[]) =>
                invoices.reduce((sum, inv) => {
                  const pays = inv.payments || [];
                  // فواتير قديمة بلا سجل دفعات: نعتمد المبلغ المدفوع بتاريخ الفاتورة.
                  if (pays.length === 0) {
                    return sum + (isDateInRange(inv.date) ? (inv.paidAmount || 0) : 0);
                  }
                  return sum + pays.filter(p => isDateInRange(p.date)).reduce((ps, p) => ps + p.amount, 0);
                }, 0);

              const cashFromSales = cashMovedInRange(salesInvoices);
              // العربون فقط: عند تسليم التذكرة يُحوَّل الباقي إلى فاتورة بيع،
              // فاحتسابه هنا أيضاً يعني حسابه مرتين.
              const maintenanceDeposits = filteredMaintenance.reduce((sum, t) => sum + (t.deposit || 0), 0);
              const totalCashIn = cashFromSales + maintenanceDeposits;

              const cashToSuppliers = cashMovedInRange(purchases);
              const totalExpensesAmount = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);
              const totalCashOut = cashToSuppliers + totalExpensesAmount;
              const currentCashBalance = totalCashIn - totalCashOut;

              let totalSalesProfit = 0;
              filteredSales.forEach(inv => {
                inv.items.forEach(item => {
                  // الكلفة المسجّلة في الفاتورة هي كلفة وقت البيع؛ نعتمدها بدل
                  // كلفة المنتج الحالية حتى لا تتغيّر أرباح الماضي بتغيّر الأسعار
                  // أو تصير صفراً إذا حُذف المنتج لاحقاً.
                  const cost = item.costPrice ?? products.find(p => p.id === item.id)?.costPrice ?? 0;
                  // cartQuantity هي الكمية المباعة؛ quantity رصيد المخزن وقت البيع.
                  totalSalesProfit += (item.price - cost) * item.cartQuantity;
                });
              });
              const damagesLoss = filteredDamages.reduce((sum, d) => sum + (d.costPrice * d.quantity), 0);
              // العربون يدخل الربح مباشرة؛ أما باقي أجور الصيانة فيصير فاتورة بيع
              // عند التسليم ويُحتسب ضمن totalSalesProfit، فلا يُضاف هنا ثانية.
              const maintenanceProfit = maintenanceDeposits;
              const netProfit = totalSalesProfit + maintenanceProfit - damagesLoss - totalExpensesAmount;

              const debtsForUs = salesInvoices.filter(i => i.paymentStatus === 'credit').reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);
              const debtsOnUs = purchases.filter(i => i.paymentStatus === 'credit').reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);

              const inventoryCostValue = products.reduce((sum, p) => sum + ((Number(p.costPrice) || 0) * (Number(p.quantity) || 0)), 0);
              const inventorySaleValue = products.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.quantity) || 0)), 0);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* الأرقام الأربعة التي يحتاجها صاحب المحل يومياً.
                      الباقي تفاصيل داعمة، فنُزلت لشريط أهدأ تحتها. */}
                  <div className="kpi-grid">
                    <div className="kpi kpi-primary">
                      <span className="kpi-label"><i className="fa-solid fa-vault"></i> الرصيد بالصندوق</span>
                      <span className="kpi-value">{currentCashBalance.toLocaleString()}<small> د.ع</small></span>
                      <span className="kpi-hint">الموجود بالدرج الآن</span>
                    </div>
                    <div className={`kpi ${netProfit >= 0 ? 'kpi-good' : 'kpi-bad'}`}>
                      <span className="kpi-label"><i className="fa-solid fa-scale-balanced"></i> الربح الصافي</span>
                      <span className="kpi-value">{netProfit.toLocaleString()}<small> د.ع</small></span>
                      <span className="kpi-hint">بعد خصم الخسائر والمصاريف</span>
                    </div>
                    <div className="kpi kpi-warn">
                      <span className="kpi-label"><i className="fa-solid fa-hand-holding-dollar"></i> ديون لنا</span>
                      <span className="kpi-value">{debtsForUs.toLocaleString()}<small> د.ع</small></span>
                      <span className="kpi-hint">نطلبها من الزبائن</span>
                    </div>
                    <div className="kpi kpi-bad">
                      <span className="kpi-label"><i className="fa-solid fa-file-invoice"></i> ديون علينا</span>
                      <span className="kpi-value">{debtsOnUs.toLocaleString()}<small> د.ع</small></span>
                      <span className="kpi-hint">يطلبها الموردون</span>
                    </div>
                  </div>

                  <div className="glass-card" style={{ padding: '20px 24px' }}>
                    <h3 className="detail-title"><i className="fa-solid fa-list-ul"></i> التفاصيل</h3>
                    <div className="detail-grid">
                      <div className="detail-row">
                        <span>المقبوضات <em>مبيعات نقدية + أقساط + صيانة</em></span>
                        <b className="up">{totalCashIn.toLocaleString()} د.ع</b>
                      </div>
                      <div className="detail-row">
                        <span>المدفوعات <em>مشتريات + أقساط موردين + مصاريف</em></span>
                        <b className="down">{totalCashOut.toLocaleString()} د.ع</b>
                      </div>
                      <div className="detail-row">
                        <span>أرباح المبيعات والصيانة</span>
                        <b className="up">{(totalSalesProfit + maintenanceProfit).toLocaleString()} د.ع</b>
                      </div>
                      <div className="detail-row">
                        <span>الخسائر <em>توالف + مصاريف</em></span>
                        <b className="down">{(damagesLoss + totalExpensesAmount).toLocaleString()} د.ع</b>
                      </div>
                      <div className="detail-row">
                        <span>رأس مال المخزن <em>بسعر الشراء</em></span>
                        <b>{inventoryCostValue.toLocaleString()} د.ع</b>
                      </div>
                      <div className="detail-row">
                        <span>القيمة المتوقعة للبيع</span>
                        <b>{inventorySaleValue.toLocaleString()} د.ع</b>
                      </div>
                    </div>
                  </div>

                  {/* EXPENSES */}
                  <div className="glass-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ margin: 0, fontSize: '16px' }}><i className="fa-solid fa-file-invoice-dollar text-warning"></i> المصاريف التشغيلية (إيجار، رواتب، الخ)</h3>
                      <div>
                        <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px', marginLeft: '8px' }} onClick={() => exportTableToWord('expenses-table', 'المصاريف التشغيلية')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button>
                        <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => setExpenseModal({ isOpen: true, amount: '', category: 'عام', note: '' })}>
                          <i className="fa-solid fa-plus"></i> إضافة مصروف
                        </button>
                      </div>
                    </div>
                    {filteredExpenses.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>لا توجد مصاريف مسجلة في هذه الفترة.</div>
                    ) : (
                      <table className="glass-table" id="expenses-table" style={{ width: '100%', fontSize: '13px' }}>
                        <thead><tr><th style={{ padding: '10px' }}>التاريخ</th><th style={{ padding: '10px' }}>النوع</th><th style={{ padding: '10px' }}>المبلغ</th><th style={{ padding: '10px' }}>ملاحظات</th><th style={{ padding: '10px', textAlign: 'center' }}>إجراء</th></tr></thead>
                        <tbody>
                          {filteredExpenses.map(exp => (
                            <tr key={exp.id}>
                              <td style={{ padding: '10px' }}>{exp.date}</td>
                              <td style={{ padding: '10px' }}><span className="badge badge-warning">{exp.category}</span></td>
                              <td style={{ padding: '10px', color: 'var(--danger-color)', fontWeight: 'bold' }}>{exp.amount.toLocaleString()} د.ع</td>
                              <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{exp.note || '-'}</td>
                              <td style={{ padding: '10px', textAlign: 'center' }}><button className="btn-close" style={{ margin: '0 auto' }} onClick={async () => { if(confirm('هل أنت متأكد من حذف هذا المصروف؟')) { await supabase.from('expenses').delete().eq('id', exp.id); setExpenses(expenses.filter(e => e.id !== exp.id)); } }}><i className="fa-solid fa-trash"></i></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      </main>

      {/* ================= MODALS (Inventory, Purchasing, View, Delete) ================= */}
      {/* Kept exactly same as previous, just collapsed to save tokens as no changes are needed in modals */}
      {/* INVENTORY MODAL */}
      {isInvModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animated">
             <div className="modal-header">
              <h2>{invModalType === 'add' ? 'إضافة مادة جديدة' : 'تعديل بيانات المادة'}</h2>
              <button className="btn-close" onClick={closeInvModal}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>صورة المادة <span style={{ fontWeight: 400, opacity: 0.7 }}>(تظهر للكاشير في شاشة البيع)</span></label>
                <div className="img-upload">
                  <div className="img-upload-preview">
                    {invFormData.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element -- static export + images.unoptimized، فـ next/image بلا فائدة هنا
                      ? <img src={invFormData.imageUrl} alt={invFormData.name || 'صورة المادة'} />
                      : <i className="fa-solid fa-image"></i>}
                  </div>
                  <div className="img-upload-actions">
                    <label className="btn btn-secondary" style={{ cursor: imageUploading ? 'wait' : 'pointer' }}>
                      <i className={imageUploading ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-arrow-up-from-bracket'}></i>
                      {imageUploading ? ' جارٍ الرفع…' : (invFormData.imageUrl ? ' تغيير الصورة' : ' اختر صورة')}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={imageUploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = ''; // يسمح بإعادة اختيار الملف نفسه
                          if (!file) return;
                          setImageUploading(true);
                          const { url, error } = await uploadProductImage(file);
                          setImageUploading(false);
                          if (error) return setErrorModal({ isOpen: true, message: 'تعذّر رفع الصورة: ' + error });
                          if (url) setInvFormData(prev => ({ ...prev, imageUrl: url }));
                        }}
                      />
                    </label>
                    {invFormData.imageUrl && (
                      <button
                        className="btn btn-secondary"
                        style={{ color: 'var(--danger-color)' }}
                        onClick={() => setInvFormData({ ...invFormData, imageUrl: undefined })}
                      >
                        <i className="fa-solid fa-trash"></i> إزالة
                      </button>
                    )}
                    <span className="img-upload-hint">JPG أو PNG — حتى 3 ميغابايت</span>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label>الباركود</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" style={{ flex: 1 }} value={invFormData.barcode} onChange={(e) => setInvFormData({...invFormData, barcode: e.target.value})} />
                  <button className="btn btn-secondary" onClick={generateBarcode}><i className="fa-solid fa-barcode"></i> توليد</button>
                </div>
              </div>
              <div className="form-group">
                <label>اسم المادة</label>
                <input type="text" value={invFormData.name} onChange={(e) => setInvFormData({...invFormData, name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>التصنيف</label>
                {!showAddCategory ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select style={{ flex: 1 }} value={invFormData.category} onChange={(e) => setInvFormData({...invFormData, category: e.target.value})}>
                      {categories.map((cat, idx) => <option key={idx} value={cat}>{cat}</option>)}
                    </select>
                    <button className="btn btn-secondary" title="إضافة تصنيف جديد" onClick={() => setShowAddCategory(true)}><i className="fa-solid fa-plus"></i></button>
                    <button className="btn btn-secondary" title="حذف التصنيف المحدد" style={{ color: 'var(--danger-color)', padding: '0 12px' }} onClick={handleDeleteCategory}><i className="fa-solid fa-trash"></i></button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" style={{ flex: 1 }} placeholder="تصنيف جديد..." value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                    <button className="btn btn-save" onClick={handleAddCategory}>إضافة</button>
                    <button className="btn btn-secondary" onClick={() => setShowAddCategory(false)}>إلغاء</button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>الكمية المتوفرة</label>
                  <input type="number" value={invFormData.quantity} onChange={(e) => setInvFormData({...invFormData, quantity: Number(e.target.value)})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>نقطة التنبيه</label>
                  <input type="number" value={invFormData.lowStockAlert} onChange={(e) => setInvFormData({...invFormData, lowStockAlert: Number(e.target.value)})} />
                </div>
              </div>
              <div className="form-group">
                <label>السعر (للبيع)</label>
                <input type="number" value={invFormData.price} onChange={(e) => setInvFormData({...invFormData, price: Number(e.target.value)})} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeInvModal}>إلغاء</button>
              <button className="btn btn-save" onClick={handleSaveInvModal}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* PURCHASING MODAL */}
      {isPurModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animated" style={{ maxWidth: '850px' }}>
             <div className="modal-header">
              <h2>{purModalType === 'add' ? 'تسجيل فاتورة مشتريات' : 'تعديل فاتورة المشتريات'}</h2>
              <button className="btn-close" onClick={closePurModal}><i className="fa-solid fa-xmark"></i></button>
            </div>
            
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group"><label>رقم الفاتورة (رقم القائمة)</label><input type="text" value={purFormData.invoiceNumber} onChange={(e) => setPurFormData({...purFormData, invoiceNumber: e.target.value})} placeholder="اكتب رقم القائمة الورقية..." /></div>
                <div className="form-group"><label>اسم المورد</label><input type="text" value={purFormData.supplierName} onChange={(e) => setPurFormData({...purFormData, supplierName: e.target.value})} /></div>
                <div className="form-group"><label>تاريخ الفاتورة</label><input type="date" value={purFormData.date} onChange={(e) => setPurFormData({...purFormData, date: e.target.value})} /></div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--glass-border)', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', marginBottom: '16px', color: 'var(--accent-color)' }}><i className="fa-solid fa-box-open"></i> مواد الفاتورة</h3>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>المادة (اختر أو اكتب مادة جديدة)</label>
                    <input list="inventory-products" placeholder="اسم المادة..." value={currentPurItem.name} onChange={(e) => setCurrentPurItem({...currentPurItem, name: e.target.value})} />
                    <datalist id="inventory-products">{products.map(p => <option key={p.id} value={p.name} />)}</datalist>
                  </div>
                  <div className="form-group" style={{ flex: '1 1 120px', marginBottom: 0 }}><label style={{ fontSize: '12px' }}>الكمية</label><input type="number" min="1" value={currentPurItem.quantity || ''} onChange={(e) => setCurrentPurItem({...currentPurItem, quantity: Number(e.target.value)})} /></div>
                  <div className="form-group" style={{ flex: '1 1 120px', marginBottom: 0 }}><label style={{ fontSize: '12px' }}>سعر الشراء</label><input type="number" min="1" value={currentPurItem.costPrice || ''} onChange={(e) => setCurrentPurItem({...currentPurItem, costPrice: Number(e.target.value)})} /></div>
                  <button className="btn btn-primary" onClick={addPurItemToInvoice} style={{ height: '42px', minWidth: '100px', flexShrink: 0 }}><i className="fa-solid fa-plus"></i> إدراج</button>
                </div>
                {purFormData.items.length > 0 && (
                  <table className="glass-table" style={{ fontSize: '13px', width: '100%', marginTop: '16px' }}>
                    <thead><tr><th style={{ padding: '8px' }}>اسم المادة</th><th style={{ padding: '8px' }}>الكمية</th><th style={{ padding: '8px' }}>سعر الشراء</th><th style={{ padding: '8px' }}>الإجمالي</th><th style={{ padding: '8px', textAlign: 'center' }}>حذف</th></tr></thead>
                    <tbody>{purFormData.items.map(item => (<tr key={item.id}><td style={{ padding: '8px' }}>{item.name}</td><td style={{ padding: '8px' }}>{item.quantity}</td><td style={{ padding: '8px' }}>{item.costPrice.toLocaleString()}</td><td style={{ padding: '8px', color: 'var(--success-color)', fontWeight: 'bold' }}>{item.total.toLocaleString()}</td><td style={{ padding: '8px', textAlign: 'center' }}><button className="btn-close" onClick={() => removePurItem(item.id)}><i className="fa-solid fa-trash"></i></button></td></tr>))}</tbody>
                  </table>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group"><label>إجمالي الفاتورة</label><input type="text" readOnly value={`${purFormData.totalAmount.toLocaleString()} د.ع`} style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--success-color)', fontWeight: 'bold', fontSize: '18px' }} /></div>
                <div className="form-group"><label>حالة الدفع</label><select value={purFormData.paymentStatus} onChange={(e) => setPurFormData({...purFormData, paymentStatus: e.target.value as 'paid' | 'credit'})}><option value="paid">تم الدفع نقداً (كاش)</option><option value="credit">آجل (دفع جزئي أو آجل)</option></select></div>
              </div>
              {purFormData.paymentStatus === 'credit' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label>المبلغ المدفوع (الواصل للمورد)</label>
                    <input type="number" min="0" value={purFormData.paidAmount} onChange={(e) => setPurFormData({...purFormData, paidAmount: Number(e.target.value)})} placeholder="المبلغ الواصل..." />
                  </div>
                  <div className="form-group">
                    <label>تاريخ الاستحقاق (التسديد)</label>
                    <input type="date" value={purFormData.dueDate || ''} onChange={(e) => setPurFormData({...purFormData, dueDate: e.target.value})} />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closePurModal}>إلغاء</button>
              <button className="btn btn-save" onClick={handlePurSave}>{purModalType === 'add' ? 'حفظ وإضافة للمخزن' : 'تحديث الفاتورة'}</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PUR INVOICE MODAL */}
      {isViewPurModalOpen && selectedInvoice && (
        <div className="modal-overlay">
          <div className="modal-content animated" style={{ maxWidth: '950px' }}>
            <div className="modal-header">
              <h2>تفاصيل فاتورة المشتريات</h2>
              <button className="btn-close" onClick={closeViewPurModal}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div><span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>رقم الفاتورة:</span><span style={{ fontSize: '18px', fontWeight: 'bold' }}>{selectedInvoice.invoiceNumber}</span></div>
                  <div><span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>التاريخ:</span><span style={{ fontSize: '16px' }}>{selectedInvoice.date}</span></div>
                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--glass-border)', paddingTop: '16px' }}>
                    <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>المورد / الشركة:</span>
                    <span style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--accent-color)' }}>{selectedInvoice.supplierName}</span>
                  </div>
                </div>
                <table className="glass-table" style={{ fontSize: '14px', width: '100%', marginBottom: '24px' }}>
                  <thead><tr><th style={{ padding: '10px' }}>اسم المادة</th><th style={{ padding: '10px' }}>الكمية</th><th style={{ padding: '10px' }}>سعر الشراء</th><th style={{ padding: '10px' }}>الإجمالي</th></tr></thead>
                  <tbody>{selectedInvoice.items.map(item => (<tr key={item.id}><td style={{ padding: '10px' }}>{item.name}</td><td style={{ padding: '10px' }}>{item.quantity}</td><td style={{ padding: '10px' }}>{item.costPrice.toLocaleString()} د.ع</td><td style={{ padding: '10px', fontWeight: 'bold' }}>{item.total.toLocaleString()} د.ع</td></tr>))}</tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0, 0, 0, 0.2)', padding: '16px', borderRadius: '8px', flexWrap: 'wrap', gap: '16px' }}>
                  <div><span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>إجمالي الفاتورة:</span><span style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--success-color)' }}>{selectedInvoice.totalAmount.toLocaleString()} د.ع</span></div>
                  {selectedInvoice.paymentStatus === 'credit' && (
                    <>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>الواصل (المدفوع):</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--warning-color)' }}>{(selectedInvoice.paidAmount || 0).toLocaleString()} د.ع</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>الباقي (الديون):</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--danger-color)' }}>{(selectedInvoice.totalAmount - (selectedInvoice.paidAmount || 0)).toLocaleString()} د.ع</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>تاريخ التسديد:</span>
                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>{selectedInvoice.dueDate || 'غير محدد'}</span>
                      </div>
                    </>
                  )}
                  <div style={{ textAlign: 'left' }}><span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px' }}>حالة الدفع:</span>{selectedInvoice.paymentStatus === 'paid' ? <span className="badge badge-success"><i className="fa-solid fa-check"></i> تم الدفع</span> : <span className="badge badge-warning"><i className="fa-solid fa-clock"></i> آجل (دين)</span>}</div>
                </div>
                {/* عرض فقط هنا؛ التعديل والحذف من نافذة الدفعات (زر "دفع"). */}
                <div style={{ marginTop: '24px' }}>
                  <PaymentLedger
                    payments={selectedInvoice.payments || []}
                    totalAmount={selectedInvoice.totalAmount}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAMAGE MODAL */}
      {isDamageModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animated" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-trash-can text-danger"></i> تسجيل مادة تالفة</h2>
              <button className="btn-close" onClick={() => setIsDamageModalOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>المادة التالفة (اختر من المخزن)</label>
                <select 
                  value={damageFormData.itemId} 
                  onChange={(e) => {
                    const prod = products.find(p => p.id === e.target.value);
                    setDamageFormData({...damageFormData, itemId: e.target.value, itemName: prod?.name || '', costPrice: prod ? (prod.price / 1.25) : 0}); // Approximate cost price
                  }}
                >
                  <option value="">-- اختر المادة --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (المتوفر: {p.quantity})</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>الكمية التالفة</label>
                  <input type="number" min="1" value={damageFormData.quantity} onChange={(e) => setDamageFormData({...damageFormData, quantity: Number(e.target.value)})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>سبب التلف</label>
                  <select value={damageFormData.reason} onChange={(e) => setDamageFormData({...damageFormData, reason: e.target.value})}>
                    <option value="سوء خزن">سوء خزن</option>
                    <option value="تلف أثناء النقل">تلف أثناء النقل</option>
                    <option value="انقطاع الكهرباء">انقطاع الكهرباء</option>
                    <option value="انتهاء الصلاحية">انتهاء الصلاحية</option>
                    <option value="كسر / عيب مصنعي">كسر / عيب مصنعي</option>
                    <option value="أخرى">أخرى</option>
                  </select>
                </div>
              </div>
              {damageFormData.itemId && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)', marginTop: '8px' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                    قيمة الخسارة التقديرية: <strong style={{ color: 'var(--danger-color)', fontSize: '16px' }}>{(damageFormData.quantity * damageFormData.costPrice).toLocaleString()} د.ع</strong>
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--warning-color)' }}>
                    سيتم خصم هذه الكمية من المخزن نهائياً.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsDamageModalOpen(false)}>إلغاء</button>
              <button className="btn btn-save" style={{ background: 'var(--danger-color)' }} onClick={handleSaveDamage}>حفظ وخصم</button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCTION MODAL */}
      {isProductionModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animated" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-boxes-packing text-primary"></i> إنتاج / تجميع منتج جديد</h2>
              <button className="btn-close" onClick={() => setIsProductionModalOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--glass-border)' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--accent-color)' }}>1. تفاصيل المنتج النهائي</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label>اسم المنتج النهائي (مثال: تجميعة ألعاب أو كيكة)</label>
                    <input type="text" value={productionFormData.producedItemName} onChange={(e) => setProductionFormData({...productionFormData, producedItemName: e.target.value})} placeholder="أدخل الاسم..." />
                  </div>
                  <div className="form-group">
                    <label>التصنيف</label>
                    <select value={productionFormData.category} onChange={(e) => setProductionFormData({...productionFormData, category: e.target.value})}>
                      {categories.map((c, i) => <option key={i} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>الكمية المراد إنتاجها</label>
                    <input type="number" min="1" value={productionFormData.quantityProduced} onChange={(e) => setProductionFormData({...productionFormData, quantityProduced: Number(e.target.value)})} />
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--accent-color)' }}>2. المواد الأولية (الداخلة في صناعة 1 قطعة من المنتج)</h3>
                
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
                  <div className="form-group" style={{ flex: 2, margin: 0 }}>
                    <label>المادة الأولية</label>
                    <select 
                      value={prodComponentInput.itemId} 
                      onChange={(e) => {
                        const p = products.find(x => x.id === e.target.value);
                        setProdComponentInput({...prodComponentInput, itemId: e.target.value, costPrice: p ? (p.price / 1.25) : 0});
                      }}
                    >
                      <option value="">-- اختر --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} (متوفر: {p.quantity})</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1, margin: 0 }}>
                    <label>الكمية المستخدمة</label>
                    <input type="number" min="1" value={prodComponentInput.quantityUsed} onChange={(e) => setProdComponentInput({...prodComponentInput, quantityUsed: Number(e.target.value)})} />
                  </div>
                  <button className="btn btn-secondary" style={{ height: '42px', padding: '0 20px' }} onClick={addComponentToProduction}>
                    <i className="fa-solid fa-plus"></i> أضف
                  </button>
                </div>

                <table className="glass-table" style={{ fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th>اسم المادة الأولية</th>
                      <th>الكمية (لقطعة واحدة)</th>
                      <th>إجمالي المطلوب</th>
                      <th>حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionFormData.components.map((c, i) => (
                      <tr key={i}>
                        <td>{c.itemName}</td>
                        <td>{c.quantityUsed}</td>
                        <td style={{ color: 'var(--warning-color)', fontWeight: 'bold' }}>{c.quantityUsed * productionFormData.quantityProduced} (يخصم)</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn-close" onClick={() => removeComponentFromProduction(c.itemId)}><i className="fa-solid fa-trash"></i></button>
                        </td>
                      </tr>
                    ))}
                    {productionFormData.components.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: '16px' }}>لم يتم إضافة أي مواد أولية.</td></tr>}
                  </tbody>
                </table>
              </div>

            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ color: 'var(--success-color)', fontWeight: 'bold' }}>
                <i className="fa-solid fa-calculator"></i> التكلفة الإجمالية التقديرية: {(
                  productionFormData.components.reduce((sum, c) => sum + (c.costPrice * c.quantityUsed * productionFormData.quantityProduced), 0)
                ).toLocaleString()} د.ع
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setIsProductionModalOpen(false)}>إلغاء</button>
                <button className="btn btn-save" onClick={handleSaveProduction}>تنفيذ وإنتاج</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAINTENANCE MODAL */}
      {isMaintenanceModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animated" style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-screwdriver-wrench text-primary"></i> {maintenanceModalType === 'add' ? 'استلام جهاز صيانة جديد' : 'تحديث تذكرة صيانة'}</h2>
              <button className="btn-close" onClick={() => setIsMaintenanceModalOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                {/* Customer Info */}
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--accent-color)' }}><i className="fa-solid fa-user"></i> معلومات الزبون والوصل</h3>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label>رقم وصل الصيانة (رقم الوصل الورقي)</label>
                    <input type="text" value={maintenanceFormData.ticketNumber} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, ticketNumber: e.target.value})} placeholder="رقم الوصل..." />
                  </div>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label>اسم الزبون</label>
                    <input type="text" value={maintenanceFormData.customerName} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, customerName: e.target.value})} placeholder="الاسم الكامل" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>رقم الهاتف</label>
                    <input type="text" value={maintenanceFormData.customerPhone} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, customerPhone: e.target.value})} placeholder="07..." />
                  </div>
                </div>

                {/* Device Info */}
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--accent-color)' }}><i className="fa-solid fa-mobile-screen"></i> معلومات الجهاز</h3>
                  <div className="form-group">
                    <label>نوع الجهاز وموديله</label>
                    <input type="text" value={maintenanceFormData.deviceType} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, deviceType: e.target.value})} placeholder="مثال: آيفون 13 برو، غسالة ال جي..." />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>وصف العطل / المشكلة</label>
                    <input type="text" value={maintenanceFormData.issueDescription} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, issueDescription: e.target.value})} placeholder="وصف مبدئي للعطل..." />
                  </div>
                </div>
              </div>

              {/* Status and Financials */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>حالة الصيانة</label>
                  <select value={maintenanceFormData.status} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, status: e.target.value as MaintenanceStatus})}>
                    <option value="pending">قيد الانتظار</option>
                    <option value="in_progress">قيد العمل</option>
                    <option value="waiting_parts">بانتظار قطع</option>
                    <option value="completed">تم الإنجاز (جاهز)</option>
                    <option value="rejected">مرفوض / لا يصلح</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>مدة الضمان</label>
                  <select value={maintenanceFormData.warrantyPeriod} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, warrantyPeriod: e.target.value})}>
                    <option value="بدون ضمان">بدون ضمان</option>
                    <option value="ضمان 3 أيام">ضمان 3 أيام</option>
                    <option value="ضمان أسبوع">ضمان أسبوع</option>
                    <option value="ضمان شهر">ضمان شهر</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>التكلفة الإجمالية (أجور + قطع)</label>
                  <input type="number" min="0" value={maintenanceFormData.estimatedCost} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, estimatedCost: Number(e.target.value)})} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>العربون (المقدمة المستلمة)</label>
                  <input type="number" min="0" value={maintenanceFormData.deposit} onChange={(e) => setMaintenanceFormData({...maintenanceFormData, deposit: Number(e.target.value)})} />
                </div>
              </div>

              {/* Used Parts from Inventory */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--accent-color)' }}><i className="fa-solid fa-microchip"></i> قطع الغيار المسحوبة من المخزن</h3>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
                  <div className="form-group" style={{ flex: 2, margin: 0 }}>
                    <label>قطعة الغيار</label>
                    <select 
                      value={partInput.itemId} 
                      onChange={(e) => setPartInput({...partInput, itemId: e.target.value})}
                    >
                      <option value="">-- اختر من المخزن --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} (السعر: {p.price.toLocaleString()} د.ع)</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1, margin: 0 }}>
                    <label>الكمية المستخدمة</label>
                    <input type="number" min="1" value={partInput.quantity} onChange={(e) => setPartInput({...partInput, quantity: Number(e.target.value)})} />
                  </div>
                  <button className="btn btn-secondary" style={{ height: '42px', padding: '0 20px' }} onClick={addPartToMaintenance}>
                    <i className="fa-solid fa-plus"></i> سحب وإضافة
                  </button>
                </div>

                <table className="glass-table" style={{ fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th>اسم القطعة</th>
                      <th>الكمية</th>
                      <th>سعر القطعة</th>
                      <th>الإجمالي</th>
                      <th>حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenanceFormData.usedParts.map((p, i) => (
                      <tr key={i}>
                        <td>{p.itemName}</td>
                        <td>{p.quantity}</td>
                        <td>{p.sellPrice.toLocaleString()}</td>
                        <td style={{ fontWeight: 'bold' }}>{(p.sellPrice * p.quantity).toLocaleString()}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn-close" onClick={() => removePartFromMaintenance(p.itemId)}><i className="fa-solid fa-trash"></i></button>
                        </td>
                      </tr>
                    ))}
                    {maintenanceFormData.usedParts.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-secondary)' }}>لم يتم سحب أي قطع غيار لهذه التذكرة.</td></tr>}
                  </tbody>
                </table>
              </div>

            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ color: maintenanceFormData.estimatedCost - maintenanceFormData.deposit < 0 ? 'var(--warning-color)' : 'var(--success-color)', fontWeight: 'bold' }}>
                <i className="fa-solid fa-money-bill"></i>{' '}
                {maintenanceFormData.estimatedCost - maintenanceFormData.deposit >= 0 
                  ? `المبلغ المتبقي على الزبون: ${(maintenanceFormData.estimatedCost - maintenanceFormData.deposit).toLocaleString()} د.ع`
                  : `المبلغ الزائد (يُعاد للزبون): ${Math.abs(maintenanceFormData.estimatedCost - maintenanceFormData.deposit).toLocaleString()} د.ع`
                }
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setIsMaintenanceModalOpen(false)}>إلغاء</button>
                <button className="btn btn-save" onClick={handleSaveMaintenanceTicket}>حفظ التذكرة</button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {deleteConfirm.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content animated" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ color: 'var(--danger-color)', fontSize: '48px', marginBottom: '16px' }}><i className="fa-solid fa-triangle-exclamation"></i></div>
            <h2 style={{ marginBottom: '16px', fontSize: '20px' }}>تأكيد الحذف</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>هل أنت متأكد من حذف <strong>&laquo;{deleteConfirm.title}&raquo;</strong>؟<br/>{deleteConfirm.type === 'purchasing' && <span style={{ color: 'var(--warning-color)', fontSize: '13px' }}>ملاحظة: سيتم خصم كميات هذه الفاتورة من المخزن أيضاً!</span>}{deleteConfirm.type === 'sales' && <span style={{ color: 'var(--warning-color)', fontSize: '13px' }}>ملاحظة: سترجع الكميات المباعة إلى المخزن، وتُحذف الفاتورة من الإحصائيات.</span>} لا يمكن التراجع.</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setDeleteConfirm({ isOpen: false, id: '', type: 'inventory', title: '' })}>إلغاء</button>
              <button className="btn btn-delete" style={{ flex: 1, display: 'flex', justifyContent: 'center', background: 'var(--danger-color)', color: 'white' }} onClick={executeDelete}>نعم، احذف</button>
            </div>
          </div>
        </div>
      )}

      {/* DAILY STATS MODAL */}
      {isDailyStatsOpen && (
        <div className="modal-overlay" style={{ zIndex: 9000 }}>
          <div className="modal-content animated" style={{ maxWidth: '950px' }}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-chart-pie"></i> إحصائيات مبيعات اليوم</h2>
              <button className="btn-close" onClick={() => setIsDailyStatsOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              
              <div className="dashboard-grid" style={{ marginBottom: '24px' }}>
                <div className="glass-card stat-card" style={{ padding: '16px' }}>
                  <span className="stat-title">إجمالي المبيعات</span>
                  <span className="stat-value" style={{ color: 'var(--success-color)' }}>
                    {salesInvoices.reduce((a, b) => a + b.totalAmount, 0).toLocaleString()} د.ع
                  </span>
                  <span className="stat-change"><i className="fa-solid fa-receipt"></i> {salesInvoices.length} فواتير مصدرة</span>
                </div>
                <div className="glass-card stat-card" style={{ padding: '16px' }}>
                  <span className="stat-title">الكاش (المستلم نقداً)</span>
                  <span className="stat-value">
                    {salesInvoices.reduce((a, b) => a + (b.paidAmount ?? (b.paymentStatus === 'paid' ? b.totalAmount : 0)), 0).toLocaleString()} د.ع
                  </span>
                  <span className="stat-change positive"><i className="fa-solid fa-money-bill-wave"></i> دخل الصندوق</span>
                </div>
                <div className="glass-card stat-card" style={{ padding: '16px' }}>
                  <span className="stat-title">الآجل (ديون الزبائن)</span>
                  <span className="stat-value" style={{ color: '#fbbf24' }}>
                    {salesInvoices.filter(i => i.paymentStatus === 'credit').reduce((a, b) => a + (b.totalAmount - (b.paidAmount || 0)), 0).toLocaleString()} د.ع
                  </span>
                  <span className="stat-change negative"><i className="fa-solid fa-clock"></i> ديون مستحقة للشركة</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}><h3 style={{ fontSize: '16px', margin: 0, color: 'var(--text-secondary)' }}>سجل فواتير اليوم</h3><button className="btn btn-secondary" onClick={() => exportTableToWord('sales-table', 'سجل المبيعات')}><i className="fa-solid fa-file-word"></i> تصدير وورد</button></div>
              <div style={{ overflowX: 'auto' }}>
                <table className="glass-table" id="sales-table" style={{ width: '100%', fontSize: '13px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '10px' }}>رقم الفاتورة</th>
                      <th style={{ padding: '10px' }}>الزبون</th>
                      <th style={{ padding: '10px' }}>تاريخ الشراء</th>
                      <th style={{ padding: '10px' }}>تاريخ الاستحقاق</th>
                      <th style={{ padding: '10px' }}>تفاصيل المواد</th>
                      <th style={{ padding: '10px' }}>المبلغ</th>
                      <th style={{ padding: '10px' }}>الحالة</th>
                      <th style={{ padding: '10px' }}>الإجراءات</th>
                    </tr>
                  </thead>
                <tbody>
                  {salesInvoices.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>لا توجد مبيعات لهذا اليوم بعد.</td></tr>
                  ) : (
                    salesInvoices.map(inv => (
                      <tr key={inv.id}>
                        <td><strong>{inv.invoiceNumber}</strong></td>
                        <td>{inv.customerName}</td>
                        <td>{inv.date}</td>
                        <td style={{ color: 'var(--warning-color)' }}>{inv.dueDate || '-'}</td>
                        <td style={{ fontSize: '11px', maxWidth: '200px' }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{inv.items.length} مواد:</div>
                          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {/* cartQuantity هي الكمية المباعة؛ quantity هي رصيد المخزن وقت البيع. */}
                            {inv.items.map(item => `${item.name} (${item.cartQuantity})`).join('، ')}
                          </div>
                        </td>
                        <td style={{ fontWeight: 'bold' }}>
                          {inv.totalAmount.toLocaleString()}
                          {inv.paymentStatus === 'credit' && (
                            <div style={{ fontSize: '10px', color: 'var(--warning-color)', marginTop: '4px' }}>
                              واصل: {(inv.paidAmount || 0).toLocaleString()} | باقي: {(inv.totalAmount - (inv.paidAmount || 0)).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td>
                          {inv.paymentStatus === 'paid' ? <span className="badge badge-success">كاش</span> : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                              <span className="badge badge-warning">آجل (باقي)</span>
                              <button className="btn btn-primary" style={{ fontSize: '10px', padding: '4px 6px' }} onClick={() => { setIsDailyStatsOpen(false); setPaymentModal({ isOpen: true, type: 'sales', invoiceId: inv.id, amount: 0, date: getTodayDate(), method: 'نقدي' }); }}>
                                <i className="fa-solid fa-hand-holding-dollar"></i> تسديد
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="action-btns" style={{ justifyContent: 'center' }}>
                            <button className="btn-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)' }} onClick={() => generateThermalReceipt(inv, 'sales')} title="طباعة الفاتورة">
                              <i className="fa-solid fa-print"></i>
                            </button>
                            <button className="btn-icon btn-edit" title="تعديل بيانات الفاتورة" onClick={() => setSalesEditModal({ isOpen: true, id: inv.id, customerName: inv.customerName, date: (inv.date || '').split('T')[0], dueDate: (inv.dueDate || '').split('T')[0] })}>
                              <i className="fa-solid fa-pen"></i>
                            </button>
                            <button className="btn-icon btn-delete" title="حذف الفاتورة وإرجاع الكميات" onClick={() => confirmDelete(inv.id, 'sales', inv.invoiceNumber)}>
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>

            </div>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setIsDailyStatsOpen(false)} style={{ width: '100%' }}>إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* SALES INVOICE EDIT MODAL */}
      {salesEditModal.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 9500 }}>
          <div className="modal-content animated" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-pen text-primary"></i> تعديل بيانات الفاتورة</h2>
              <button className="btn-close" onClick={() => setSalesEditModal({ ...salesEditModal, isOpen: false })}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>اسم الزبون</label>
                <input type="text" value={salesEditModal.customerName} onChange={e => setSalesEditModal({ ...salesEditModal, customerName: e.target.value })} className="glass-input" style={{ width: '100%', padding: '10px' }} />
              </div>
              <div className="form-group">
                <label>تاريخ الشراء</label>
                <input type="date" value={salesEditModal.date} onChange={e => setSalesEditModal({ ...salesEditModal, date: e.target.value })} className="glass-input" style={{ width: '100%', padding: '10px' }} />
              </div>
              <div className="form-group">
                <label>تاريخ الاستحقاق <span style={{ fontWeight: 400, opacity: 0.7 }}>(للفواتير الآجلة)</span></label>
                <input type="date" value={salesEditModal.dueDate} onChange={e => setSalesEditModal({ ...salesEditModal, dueDate: e.target.value })} className="glass-input" style={{ width: '100%', padding: '10px' }} />
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <i className="fa-solid fa-circle-info"></i> المواد والمبالغ لا تُعدَّل من هنا لأن ذلك يغيّر المخزون.
                لتصحيح مادة أو كمية، احذف الفاتورة وأعد البيع. ولتعديل الدفعات استخدم زر «تسديد».
              </p>
            </div>
            <div className="modal-footer" style={{ gap: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSalesEditModal({ ...salesEditModal, isOpen: false })}>إلغاء</button>
              <button className="btn btn-save" style={{ flex: 1 }} onClick={handleSaveSalesEdit}><i className="fa-solid fa-check"></i> حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT SUCCESS MODAL */}
      {successModal.isOpen && successModal.invoice && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content animated" style={{ maxWidth: '400px', textAlign: 'center', padding: '40px 20px' }}>
            
            <div className="success-icon-circle animate-pop">
              <i className="fa-solid fa-check"></i>
            </div>
            
            <h2 className="animate-pop" style={{ marginBottom: '8px', fontSize: '24px', color: 'var(--text-primary)' }}>تم الدفع بنجاح!</h2>
            <p className="animate-pop" style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
              تم إصدار الفاتورة رقم <strong>{successModal.invoice.invoiceNumber}</strong>
            </p>
            <div className="animate-pop" style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--success-color)', marginBottom: '32px' }}>
              {successModal.invoice.totalAmount.toLocaleString()} د.ع
            </div>

            <div className="animate-pop" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1 }} 
                onClick={() => setSuccessModal({ isOpen: false, invoice: null })}
              >
                بيع جديد
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 2, display: 'flex', justifyContent: 'center', gap: '8px' }} 
                onClick={() => {
                  if (successModal.invoice) generateThermalReceipt(successModal.invoice, 'sales');
                  setSuccessModal({ isOpen: false, invoice: null });
                }}
              >
                <i className="fa-solid fa-print"></i> طباعة الوصل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERROR MODAL */}
      {errorModal.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content animated" style={{ maxWidth: '400px', textAlign: 'center', padding: '30px 20px' }}>
            
            <div className="success-icon-circle animate-pop" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', borderColor: '#ef4444', width: '70px', height: '70px', fontSize: '30px' }}>
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            
            <h2 className="animate-pop" style={{ marginBottom: '12px', fontSize: '20px', color: 'var(--text-primary)' }}>تنبيه!</h2>
            <p className="animate-pop" style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
              {errorModal.message}
            </p>

            <button 
              className="btn btn-secondary animate-pop" 
              style={{ width: '100%' }} 
              onClick={() => setErrorModal({ isOpen: false, message: '' })}
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}

      {/* PAPER RECEIPT MOCKUP MODAL */}
      {receiptModal.isOpen && receiptModal.invoice && (
        <div className="modal-overlay" style={{ zIndex: 11000 }}>
          <div className="modal-content animated" style={{ maxWidth: '350px', background: '#f8fafc', color: '#0f172a', padding: '0' }}>
            
            {/* Simulated Paper Receipt */}
            <div style={{ padding: '24px', fontFamily: '"Courier New", Courier, monospace', fontSize: '12px' }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <i className="fa-solid fa-store" style={{ fontSize: '24px', marginBottom: '8px' }}></i>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 'bold' }}>نظام ERP التجاري</h3>
                <p style={{ margin: '0', fontSize: '10px', color: '#475569' }}>العراق - بغداد</p>
                <p style={{ margin: '0', fontSize: '10px', color: '#475569' }}>هاتف: 07700000000</p>
              </div>

              <div style={{ borderTop: '1px dashed #94a3b8', borderBottom: '1px dashed #94a3b8', padding: '8px 0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>التاريخ:</span><span>{receiptModal.invoice.date}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>رقم الفاتورة:</span><span>{receiptModal.invoice.invoiceNumber}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>الزبون:</span><span>{receiptModal.invoice.customerName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>الدفع:</span><span>{receiptModal.invoice.paymentStatus === 'paid' ? 'كاش' : 'آجل'}</span>
                </div>
              </div>

              <table style={{ width: '100%', marginBottom: '16px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ paddingBottom: '4px', textAlign: 'right' }}>المادة</th>
                    <th style={{ paddingBottom: '4px', textAlign: 'center' }}>الكمية</th>
                    <th style={{ paddingBottom: '4px', textAlign: 'left' }}>المجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptModal.invoice.items.map(item => (
                    <tr key={item.id}>
                      <td style={{ paddingTop: '8px', textAlign: 'right' }}>{item.name}</td>
                      <td style={{ paddingTop: '8px', textAlign: 'center' }}>{item.cartQuantity}</td>
                      <td style={{ paddingTop: '8px', textAlign: 'left' }}>{item.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ borderTop: '1px dashed #94a3b8', paddingTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>المجموع:</span><span>{receiptModal.invoice.subtotal.toLocaleString()}</span>
                </div>
                {receiptModal.invoice.discount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>الخصم:</span><span>{receiptModal.invoice.discount.toLocaleString()}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '16px', fontWeight: 'bold' }}>
                  <span>الصافي:</span><span>{receiptModal.invoice.totalAmount.toLocaleString()} د.ع</span>
                </div>
              </div>
              
              <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <i className="fa-solid fa-barcode" style={{ fontSize: '32px' }}></i>
                <p style={{ margin: '4px 0 0 0', fontSize: '10px' }}>شكراً لتسوقكم معنا!</p>
              </div>
            </div>

            <div style={{ display: 'flex', borderTop: '1px solid #e2e8f0' }}>
              <button 
                onClick={() => setReceiptModal({ isOpen: false, invoice: null })}
                style={{ flex: 1, padding: '12px', background: 'transparent', border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 'bold', color: '#64748b' }}
              >
                إغلاق
              </button>
              <button 
                onClick={() => {
                  window.print();
                  setReceiptModal({ isOpen: false, invoice: null });
                }}
                style={{ flex: 1, padding: '12px', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#3b82f6' }}
              >
                <i className="fa-solid fa-print"></i> طباعة حقيقية
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}
      {paymentModal.isOpen && paymentInvoice && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-content animated" style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h2>
                <i className="fa-solid fa-hand-holding-dollar text-success"></i> دفعات الفاتورة
                <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-secondary)', marginInlineStart: '10px' }}>
                  {paymentModal.type === 'purchase'
                    ? (paymentInvoice as PurchaseInvoice).supplierName
                    : (paymentInvoice as SalesInvoice).customerName}
                  {' · '}{paymentInvoice.invoiceNumber}
                </span>
              </h2>
              <button className="btn-close" onClick={() => setPaymentModal({...paymentModal, isOpen: false})}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body">
              <PaymentLedger
                payments={paymentInvoice.payments || []}
                totalAmount={paymentInvoice.totalAmount}
                onDelete={handleDeletePayment}
                deletingId={deletingPaymentId}
              />

              <h4 className="ledger-title" style={{ marginTop: '20px' }}>
                <i className="fa-solid fa-plus"></i> تسجيل دفعة جديدة
              </h4>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                  <label>تاريخ التسديد</label>
                  <input type="date" value={paymentModal.date} onChange={e => setPaymentModal({...paymentModal, date: e.target.value})} className="glass-input" style={{ width: '100%', padding: '10px' }} />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                  <label>المبلغ (د.ع)</label>
                  <input type="number" min="1" value={paymentModal.amount || ''} onChange={e => setPaymentModal({...paymentModal, amount: Number(e.target.value)})} placeholder="المبلغ..." className="glass-input" style={{ width: '100%', padding: '10px' }} />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                  <label>طريقة الدفع</label>
                  <select value={paymentModal.method} onChange={e => setPaymentModal({...paymentModal, method: e.target.value})} className="glass-input" style={{ width: '100%', padding: '10px' }}>
                    <option value="نقدي" style={{ color: 'black' }}>نقدي (كاش)</option>
                    <option value="زين كاش" style={{ color: 'black' }}>زين كاش</option>
                    <option value="حوالة بنكية" style={{ color: 'black' }}>حوالة بنكية</option>
                    <option value="أخرى" style={{ color: 'black' }}>أخرى</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ gap: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPaymentModal({...paymentModal, isOpen: false})}>إغلاق</button>
              <button className="btn btn-save" style={{ flex: 1 }} onClick={handleSavePayment}><i className="fa-solid fa-check"></i> إضافة الدفعة</button>
            </div>
          </div>
        </div>
      )}

      {/* EXPENSE MODAL */}
      {expenseModal.isOpen && (
        <div className="modal-overlay animated fadeIn">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3><i className="fa-solid fa-file-invoice-dollar text-warning"></i> إضافة مصروف تشغيلي</h3>
              <button className="btn-close" onClick={() => setExpenseModal({ isOpen: false, amount: '', category: 'عام', note: '' })}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <label>مبلغ المصروف (د.ع)</label>
                <input type="number" className="glass-input" style={{ width: '100%', padding: '10px' }} value={expenseModal.amount} onChange={e => setExpenseModal({ ...expenseModal, amount: e.target.value })} placeholder="مثال: 50000" />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label>نوع المصروف</label>
                <input type="text" className="glass-input" style={{ width: '100%', padding: '10px' }} value={expenseModal.category} onChange={e => setExpenseModal({ ...expenseModal, category: e.target.value })} placeholder="مثال: إيجار، راتب عمال، ضيافة، بانزين" list="expense-categories" />
                <datalist id="expense-categories">
                  <option value="إيجار محل" />
                  <option value="راتب عمال" />
                  <option value="ضيافة / چاي وگهوة" />
                  <option value="بانزين / نقل" />
                  <option value="إنترنت / كهرباء" />
                </datalist>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label>ملاحظات (اختياري)</label>
                <input type="text" className="glass-input" style={{ width: '100%', padding: '10px' }} value={expenseModal.note} onChange={e => setExpenseModal({ ...expenseModal, note: e.target.value })} placeholder="تفاصيل المصروف..." />
              </div>
            </div>
            <div className="modal-footer" style={{ gap: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setExpenseModal({ isOpen: false, amount: '', category: 'عام', note: '' })}>إلغاء</button>
              <button className="btn btn-primary" style={{ flex: 1, background: 'var(--success-color)' }} onClick={async () => {
                if (!expenseModal.amount || isNaN(Number(expenseModal.amount))) {
                  setErrorModal({ isOpen: true, message: 'يرجى إدخال مبلغ صحيح' });
                  return;
                }
                const newExp = { id: newId(), date: new Date().toISOString().split('T')[0], amount: Number(expenseModal.amount), category: expenseModal.category || 'عام', note: expenseModal.note };
                const dbExp = { date: newExp.date, amount: newExp.amount, category: newExp.category, description: newExp.note };
                const { data, error } = await supabase.from('expenses').insert([dbExp]).select();
                if (error) return setErrorModal({ isOpen: true, message: 'تعذّر حفظ المصروف: ' + error.message });
                if (data && data.length > 0) newExp.id = data[0].id.toString();
                setExpenses([newExp, ...expenses]);
                setExpenseModal({ isOpen: false, amount: '', category: 'عام', note: '' });
              }}><i className="fa-solid fa-check"></i> حفظ المصروف</button>
            </div>
          </div>
        </div>
      )}

      {/* BARCODE MODAL */}
      {barcodeModal.isOpen && barcodeModal.product && (
        <div className="modal-overlay animated fadeIn">
          <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div className="modal-header">
              <h3><i className="fa-solid fa-barcode text-primary"></i> طباعة باركود</h3>
              <button className="btn-close" onClick={() => setBarcodeModal({ isOpen: false, product: null })}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="modal-body" id="printable-barcode" style={{ padding: '24px', background: '#fff', color: '#000', borderRadius: '8px', margin: '16px 0' }}>
              <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' }}>{barcodeModal.product.name}</div>
              <Barcode value={barcodeModal.product.barcode} width={2} height={60} fontSize={16} margin={0} displayValue={true} />
              <div style={{ fontWeight: 'bold', fontSize: '16px', marginTop: '8px' }}>السعر: {barcodeModal.product.price.toLocaleString()} د.ع</div>
            </div>
            <div className="modal-footer" style={{ gap: '12px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setBarcodeModal({ isOpen: false, product: null })}>إلغاء</button>
              <button className="btn btn-primary" onClick={() => {
                const printContents = document.getElementById('printable-barcode')?.innerHTML;
                if (printContents) {
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    printWindow.document.write(`
                      <html>
                        <head>
                          <title>طباعة باركود</title>
                          <style>
                            body { font-family: sans-serif; text-align: center; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                          </style>
                        </head>
                        <body onload="window.print(); window.close();">
                          ${printContents}
                        </body>
                      </html>
                    `);
                    printWindow.document.close();
                  }
                }
              }}><i className="fa-solid fa-print"></i> طباعة اللصقة</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
