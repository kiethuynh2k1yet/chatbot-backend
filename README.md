# MiniChat API — đăng nhập nhân viên

Backend dùng NestJS, SQL Server, bcrypt và JWT. Người dùng đăng nhập bằng
`A30_User.username` và mật khẩu; tài khoản được liên kết với nhân viên bằng
`A30_User.user_code = A30_Employee.employee_code`. Mật khẩu được kiểm tra với
`A30_User.password_hash`. Chỉ nhân viên `is_active = 1` và tài khoản chưa xóa
(`is_delete = 0`) mới được đăng nhập. Theo cấu hình nghiệp vụ hiện tại,
`status_id` không được dùng để chặn đăng nhập.

## Cấu hình

Tạo file `.env` từ `.env.example` trong thư mục backend và điền thông tin môi
trường của bạn. Không commit `.env`, mật khẩu SQL Server hoặc JWT secret.

| Biến | Ý nghĩa |
| --- | --- |
| `PORT` | Cổng HTTP, mặc định `8081` |
| `CORS_ORIGIN` | Danh sách origin frontend, phân tách bằng dấu phẩy |
| `DB_HOST`, `DB_PORT` | SQL Server host/port |
| `DB_USERNAME`, `DB_PASSWORD` | Tài khoản database |
| `DB_DATABASE`, `DB_SCHEMA` | Database và schema (mặc định `dbo`) |
| `DB_ENCRYPT` | Mã hóa kết nối TLS, mặc định `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | Chỉ bật `true` khi dùng chứng thư tự ký, ví dụ môi trường local |
| `JWT_SECRET` | Khóa ký JWT, tối thiểu 32 ký tự ngẫu nhiên |
| `JWT_EXPIRES_IN` | Thời hạn token như `15m`, `8h` hoặc `7d` |

`ADMIN_*` trong `.env` hiện có không được sử dụng bởi endpoint đăng nhập. Tài
khoản phải được tạo và cấp bcrypt hash qua quy trình quản trị riêng.

## Chuẩn bị SQL Server

Tạo `A30_Employee` và `A30_User` trước khi chạy API. Cả hai bảng cần có khóa
chính trên `id`. Các trường mà API sử dụng:

- `A30_Employee`: `id`, `employee_code`, `full_name`, `email`, `phone`,
  `department`, `position`, `is_active`.
- `A30_User`: `id`, `user_code`, `username`, `password_hash`,
  `failed_login_count`, `locked_until`, `last_login_at`, `token_version`,
  `is_delete`.

Chạy [sql/0001_auth_indexes.sql](./sql/0001_auth_indexes.sql) một lần để bổ sung
khóa/index nếu chưa có. Kiểm tra dữ liệu trùng `employee_code` hoặc
`user_code` trước khi tạo unique index. Mã `user_code` phải bằng
`employee_code`. Hãy bỏ dấu phẩy sau cột cuối cùng trước `);` trong DDL SQL
Server.

`password_hash` phải là bcrypt hash (thường bắt đầu `$2a$` hoặc `$2b$`). Không
lưu mật khẩu nguyên văn. Sinh hash trong quy trình quản trị tin cậy, ví dụ dùng
`bcryptjs.hash(password, 12)`. bcrypt chỉ xác thực tối đa 72 byte UTF-8 cho một
mật khẩu; mật khẩu dài hơn sẽ bị từ chối.

## API

### `POST /api/auth/login`

Request:

```json
{
  "username": "nguyenvana",
  "password": "your-password"
}
```

Thành công trả `accessToken`, `tokenType`, `expiresIn` và thông tin nhân viên
không nhạy cảm. Trường `username` là đúng giá trị trong `A30_User.username`.
Username/mật khẩu sai dùng cùng một thông báo `401`. Sau 5 lần
đăng nhập sai liên tiếp, tài khoản bị khóa 15 phút; đăng nhập thành công sẽ
đặt lại bộ đếm và cập nhật `last_login_at`.

### `GET /api/auth/me`

Gửi JWT trong header `Authorization: Bearer <accessToken>`. API kiểm tra chữ ký,
thời hạn, `token_version`, trạng thái xóa tài khoản và nhân viên còn hoạt động.
Tăng `A30_User.token_version` để vô hiệu hóa các token đã cấp của tài khoản đó.

## Chạy và kiểm tra

```powershell
cd backend
npm install
npm run start:dev
```

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

API có tiền tố `/api`. CORS mặc định cho phép `http://localhost:3000`; đặt
`CORS_ORIGIN` khác khi triển khai.
