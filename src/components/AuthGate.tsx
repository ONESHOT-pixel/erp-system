'use client';

import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

/**
 * يحجب التطبيق خلف تسجيل الدخول.
 *
 * التطبيق مبني كـ static export ومنشور على GitHub Pages، فمفتاح anon مرئي
 * للجميع داخل ملفات JS. الحماية الحقيقية هي RLS في قاعدة البيانات
 * (db/001_categories_and_rls.sql) — الجداول لا تسمح إلا للدور authenticated.
 * هذه البوابة هي واجهة ذلك: بدون جلسة، لا توجد بيانات أصلاً.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <i className="fa-solid fa-circle-notch fa-spin" />
          <span>جارٍ التحقق…</span>
        </div>
      </div>
    );
  }

  if (!session) return <LoginForm />;

  return <>{children}</>;
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
          : error.message
      );
      setBusy(false);
    }
    // عند النجاح يلتقط onAuthStateChange الجلسة ويُبدِّل الشاشة،
    // فلا داعي لإيقاف حالة الانتظار هنا.
  };

  return (
    <div className="auth-screen">
      <form className="auth-card glass-panel" onSubmit={handleSubmit}>
        <div className="auth-logo">
          <i className="fa-solid fa-cubes" />
        </div>
        <h1 className="auth-title">نظام إدارة الموارد</h1>
        <p className="auth-subtitle">سجّل الدخول للمتابعة</p>

        <label className="auth-label" htmlFor="email">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          type="email"
          className="auth-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          dir="ltr"
          required
        />

        <label className="auth-label" htmlFor="password">
          كلمة المرور
        </label>
        <input
          id="password"
          type="password"
          className="auth-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
          required
        />

        {error && (
          <div className="auth-error">
            <i className="fa-solid fa-triangle-exclamation" /> {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? (
            <>
              <i className="fa-solid fa-circle-notch fa-spin" /> جارٍ الدخول…
            </>
          ) : (
            <>
              <i className="fa-solid fa-right-to-bracket" /> دخول
            </>
          )}
        </button>
      </form>
    </div>
  );
}
