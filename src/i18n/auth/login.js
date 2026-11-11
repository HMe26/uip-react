// Login page strings — Login.jsx previously had no translation wiring at
// all (every string was a hardcoded English literal), so toggling the
// language on /auth/login changed the <html dir>/<html lang> and the
// AuthLayout chrome around it, but never the form text itself.
// Shape matches useTranslations(dict) in context/LanguageContext.jsx.
export default {
  'Resend confirmation code': 'إعادة إرسال كود التأكيد',
  'Enter confirmation code': 'اكتب كود التأكيد',
  'If your account needs confirmation, a new code is on its way. Check your inbox and spam.': 'لو حسابك محتاج تأكيد، كود جديد في طريقه لبريدك. شوف الوارد والرسائل غير المرغوبة.',
  'Resend confirmation email': 'إعادة إرسال رسالة التأكيد',
  'Sending…': 'جارٍ الإرسال…',
  "Didn't get the email or can't open it?": 'مجاتلكش الرسالة أو مش قادر تفتح الإيميل؟',
  'Activate my account now': 'فعّل حسابي دلوقتي',
  'Activating…': 'جارٍ التفعيل…',
  'Account not activated? Activate it now': 'الحساب مش مفعّل؟ فعّله دلوقتي',
  'Enter your email and password first, then tap activate.': 'اكتب الإيميل وكلمة السر الأول، وبعدها اضغط تفعيل.',
  'Your account is activated. You can sign in now.': 'تم تفعيل حسابك. تقدر تسجّل الدخول دلوقتي.',
  'We sent the confirmation email. Check your inbox and spam.': 'بعتنا لك رسالة التأكيد. شوف الوارد والرسائل غير المرغوبة.',
  'If your account needs confirmation, a new email is on its way. Check your inbox and spam.': 'لو حسابك محتاج تأكيد، رسالة جديدة في طريقها لبريدك. شوف صندوق الوارد والرسائل غير المرغوبة.',
  'Welcome back': 'أهلاً بعودتك',
  'Sign in to access your dashboard': 'سجّل الدخول للوصول إلى لوحة التحكم بتاعتك',
  'Password': 'كلمة المرور',
  'Forgot password?': 'نسيت كلمة المرور؟',
  'Sign in': 'تسجيل الدخول',
  'Signing in…': 'جارٍ تسجيل الدخول…',
  "Don't have an account?": 'مفيش حساب لسه؟',
  'Create one': 'أنشئ واحد',
  'Show password': 'إظهار كلمة المرور',
  'Hide password': 'إخفاء كلمة المرور',
  'Something went wrong. Please try again.': 'حصل خطأ ما. حاول تاني.',
  'Email': 'البريد الإلكتروني',
  'Who are you?': 'إنت مين؟',
  'Choose your account type to sign in': 'اختار نوع حسابك عشان تسجّل الدخول',
  'Signing in as': 'تسجيل الدخول كـ',
  'Not a': 'مش',
  'Change account type': 'غيّر نوع الحساب',
  'Staff sign in': 'دخول الفريق',
  'Authorised platform staff only': 'مخصص لفريق إدارة المنصة فقط',
};
