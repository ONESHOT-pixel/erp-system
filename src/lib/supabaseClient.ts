import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nxwldcpmwdvlbxukysuv.supabase.co';
const supabaseAnonKey = 'sb_publishable_Wr6pEzOE0hm0p2AS_GeoxA_vsHDaz0B';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
