import { NextResponse } from 'next/server';

export function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';

  // قائمة بالبوتات التي تريد طردها ومنعها نهائياً من رؤية موقعك
  const bannedBots = [
    'facebookexternalhit',
    'Facebot',
    'TikTokBot',
    'Twitterbot',
    'LinkedInBot'
  ];

  // فحص ما إذا كان الزائر هو أحد هذه البوتات
  const isBot = bannedBots.some(bot => userAgent.toLowerCase().includes(bot.toLowerCase()));

  if (isBot) {
    // إذا كان بوتاً، اطرده فوراً وأظهر له صفحة بيضاء فارغة بنجاح (Status 403 Forbidden)
    return new NextResponse('Access Denied', { status: 403 });
  }

  // إذا كان زبوناً حقيقياً، دعه يمر ويدخل للموقع بشكل طبيعي
  return NextResponse.next();
}

// تحديد تشغيل هذا الفحص على جميع صفحات الموقع
export const config = {
  matcher: '/:path*',
};
