'use client';

import React, { useState } from 'react';

export type PaymentRecord = {
  id: string;
  date: string;
  amount: number;
  note?: string;
};

type Props = {
  payments: PaymentRecord[];
  totalAmount: number;
  /** يُمرَّر فقط عندما يُسمح بالحذف؛ بدونه يكون السجل للعرض فقط. */
  onDelete?: (paymentId: string) => void;
  /** معرّف الدفعة الجاري حذفها — لتعطيل الأزرار أثناء الاتصال. */
  deletingId?: string | null;
};

/**
 * دفتر دفعات الفاتورة: ملخّص المبالغ + سجل كل دفعة بتاريخها.
 *
 * المبلغ المدفوع يُحسب من مجموع الدفعات لا من حقل مستقل، حتى يبقى
 * الرقم متسقاً مع السجل مهما أُضيف أو حُذف منه.
 *
 * تأكيد الحذف يتم داخل الصف نفسه بدل نافذة ثانية، لأن الدفتر يُعرض
 * غالباً داخل نافذة منبثقة وتداخل النوافذ مربك.
 */
export default function PaymentLedger({ payments, totalAmount, onDelete, deletingId }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, totalAmount - paid);

  return (
    <div className="ledger">
      <div className="ledger-summary">
        <div>
          <span className="ledger-summary-label">إجمالي الفاتورة</span>
          <span className="ledger-summary-value">{totalAmount.toLocaleString()} د.ع</span>
        </div>
        <div>
          <span className="ledger-summary-label">المدفوع</span>
          <span className="ledger-summary-value paid">{paid.toLocaleString()} د.ع</span>
        </div>
        <div>
          <span className="ledger-summary-label">المتبقي</span>
          <span className={`ledger-summary-value ${remaining > 0 ? 'due' : 'paid'}`}>
            {remaining.toLocaleString()} د.ع
          </span>
        </div>
      </div>

      <h4 className="ledger-title">
        <i className="fa-solid fa-clock-rotate-left"></i> سجل الدفعات
        <span className="ledger-count">{payments.length}</span>
      </h4>

      {payments.length === 0 ? (
        <p className="ledger-empty">لم تُسجَّل أي دفعة على هذه الفاتورة بعد.</p>
      ) : (
        <ul className="ledger-list">
          {payments.map((pay) => {
            const isConfirming = confirmingId === pay.id;
            const isDeleting = deletingId === pay.id;

            return (
              <li key={pay.id} className={`ledger-row ${isConfirming ? 'confirming' : ''}`}>
                <div className="ledger-row-main">
                  <span className="ledger-date">
                    <i className="fa-regular fa-calendar"></i> {pay.date}
                  </span>
                  <span className="ledger-amount">{pay.amount.toLocaleString()} د.ع</span>
                  <span className="ledger-note">{pay.note || '—'}</span>
                </div>

                {onDelete && (
                  isConfirming ? (
                    <div className="ledger-confirm">
                      <span>حذف هذه الدفعة؟</span>
                      <button
                        type="button"
                        className="btn-icon btn-delete"
                        title="تأكيد الحذف"
                        disabled={isDeleting}
                        onClick={() => { setConfirmingId(null); onDelete(pay.id); }}
                      >
                        <i className={isDeleting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-check'}></i>
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="تراجع"
                        onClick={() => setConfirmingId(null)}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon btn-delete"
                      title="حذف الدفعة"
                      disabled={isDeleting}
                      onClick={() => setConfirmingId(pay.id)}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
