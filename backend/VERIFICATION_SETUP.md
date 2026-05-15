# 注册验证码接入清单

当前实现：

- 登录：`手机号或邮箱 + 密码 + 图形验证码`
- 注册：`手机号 + 短信验证码 + 密码 + 图形验证码`
- 邮箱：可选；如果填写邮箱，则必须输入邮箱验证码
- 手机短信：支持 `互亿无线`、`Spug 推送`、`阿里云短信`、`腾讯云短信`
- 邮箱验证码：支持 `Spug 推送`、`SMTP`
- 短信和邮箱都支持按顺序兜底

## 你现在最适合的方案

推荐顺序：

- 手机短信主通道：`互亿无线`
- 手机短信备用：`Spug 推送`
- 邮箱验证码主通道：`Spug 推送`
- 邮箱验证码备用：`SMTP`

## 1. 互亿无线短信

你需要准备：

- 互亿无线账号
- 短信 API 账号
- 短信 API 密钥

环境变量：

```env
HUYI_SMS_ENABLED=true
HUYI_SMS_API_ID=你的互亿无线API账号
HUYI_SMS_API_KEY=你的互亿无线API密钥
HUYI_SMS_ENDPOINT=https://106.ihuyi.com/webservice/sms.php?method=Submit
```

短信内容默认使用：

```env
SMS_CODE_TEMPLATE=您的注册验证码为 {code}，{minute} 分钟内有效。
```

## 2. Spug 推送

你需要准备：

- 一个可调用的 `push.spug.cc` 推送模板 URL
- 一个短信模板 URL
- 一个邮箱模板 URL

当前代码采用“URL 模板替换”方式调用，你只需要把模板 URL 配好。

支持的占位符：

- `{target}`
- `{code}`
- `{minute}`
- `{channel}`
- `{app}`

环境变量：

```env
SPUG_PUSH_APP_NAME=XK 阅读
SPUG_SMS_TEMPLATE_URL=你的Spug短信推送URL模板
SPUG_EMAIL_TEMPLATE_URL=你的Spug邮箱推送URL模板
SPUG_REQUEST_TIMEOUT_SECONDS=10
```

例如你的模板 URL 如果长这样：

```text
https://push.spug.cc/xxxx?target={target}&code={code}&minute={minute}
```

代码会自动替换其中变量。

## 3. SMTP 邮箱

如果你想让邮箱验证码有一个稳定保底通道，再配 SMTP：

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USERNAME=你的SMTP账号
SMTP_PASSWORD=你的SMTP密码或授权码
SMTP_FROM_EMAIL=no-reply@example.com
SMTP_FROM_NAME=XK 阅读
SMTP_USE_SSL=true
```

## 4. 可选保留的企业短信通道

如果你后面拿到企业资质，也可以继续启用：

- 阿里云短信
- 腾讯云短信

当前代码已经兼容，不用再改逻辑。

## 推荐顺序配置

你现在最建议先这样：

```env
SMS_PROVIDER_ORDER=huyi,spug,aliyun,tencent
EMAIL_PROVIDER_ORDER=spug,smtp
```

## 你现在只需要给我的参数

最少这一组就能先联调：

```env
HUYI_SMS_API_ID=
HUYI_SMS_API_KEY=
SPUG_SMS_TEMPLATE_URL=
SPUG_EMAIL_TEMPLATE_URL=
```

如果你还要邮箱兜底，再加：

```env
SMTP_HOST=
SMTP_PORT=
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=
SMTP_USE_SSL=true
```

## 额外建议

- 先拿互亿无线和 Spug 两个参数来打通，再考虑阿里云/腾讯云企业通道
- 所有密钥不要继续放仓库，正式上线前统一放服务端环境变量
- 模板 URL 一旦给我，我可以继续帮你做一次真实联调清单
