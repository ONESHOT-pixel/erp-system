import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'مفاتيح Supabase غير موجودة. انسخ .env.example إلى .env.local واملأ القيم.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // الجلسة تُحفظ في localStorage وتُجدَّد تلقائياً، حتى يبقى المستخدم
    // مسجَّلاً بعد تحديث الصفحة. مطلوب لأن التطبيق static export بلا خادم.
    persistSession: true,
    autoRefreshToken: true,
  },
});
