# MikroTik Traffic Dashboard v3.0.1

*Read this in other languages: [English](#english-version)*

MikroTik Traffic Dashboard là một ứng dụng Node.js hiện đại, nhẹ nhàng dùng để theo dõi lưu lượng mạng (Download/Upload) của các đường truyền WAN trên Router MikroTik. Phiên bản 3.x mang đến một bước đột phá lớn: **Chuyển đổi hoàn toàn sang cơ chế SNMP**, đọc dữ liệu trực tiếp từ RAM của router, giúp bảo vệ bộ nhớ NAND (zero NAND write) và tăng tốc độ cập nhật.

![Dashboard Preview](screenshot.png)

## ✨ Điểm mới trong v3.0.1 (Tích hợp Bot Telegram)
- **Tự động báo cáo qua Telegram**: Hệ thống tự động tổng hợp số liệu và gửi tin nhắn báo cáo lưu lượng hàng ngày vào đúng 00:00.
- **Báo cáo tháng tự động**: Tự động chốt sổ và gửi báo cáo tổng kết tháng vào lúc 00:01 ngày mùng 1 hàng tháng.
- **Không suy hao khi đổi Router**: Báo cáo Telegram giờ đây đọc dữ liệu từ chính Database nội bộ của Dashboard, không còn bị mất số liệu khi bạn thay đổi thiết bị MikroTik hay khởi động lại Router.
- Sửa lỗi kết nối IPv6 khi kết nối tới API của Telegram.

## 🚀 Tính năng chính
- **Theo dõi thời gian thực**: Biểu đồ tự động cập nhật liên tục.
- **Phân tích lịch sử**: Xem lại dữ liệu đã sử dụng theo **Giờ**, **Ngày**, **Tháng** và **Năm**.
- **Biểu đồ mượt mà**: Sử dụng Chart.js để vẽ biểu đồ sắc nét và tương tác tốt.
- **Không cần cài đặt Database**: Dữ liệu được lưu thẳng vào file JSON nhẹ nhàng (`history.json`, `hourly.json`).
- **Gửi cảnh báo Telegram**: Báo cáo tổng kết lưu lượng định kỳ hàng ngày và hàng tháng.

## ⚙️ Yêu cầu hệ thống
- **Node.js** (phiên bản v14 trở lên)
- **MikroTik RouterOS** (phiên bản v6 hoặc v7) đã bật **SNMP** và **REST API**.

## 🛠️ Hướng dẫn Cài đặt

1. **Tải mã nguồn**:
   ```bash
   git clone https://github.com/manh9992/mikrotik-traffic-dashboard.git
   cd mikrotik-traffic-dashboard
   ```

2. **Cài đặt thư viện**:
   ```bash
   npm install
   ```

3. **Cấu hình (Bắt buộc cho chức năng Telegram)**:
   Đổi tên file `config.example.json` thành `config.json` và điền Token/ChatID của Telegram Bot vào nếu bạn muốn nhận báo cáo:
   ```bash
   cp config.example.json config.json
   nano config.json
   ```

4. **Chạy server**:
   ```bash
   node server.js
   ```
   *(Khuyên dùng `pm2` hoặc `systemd` để chạy ẩn 24/7).*

5. **Truy cập Dashboard**:
   Mở trình duyệt và vào địa chỉ `http://<ip-may-chu>:3001`.

## 🌐 Hướng dẫn Cấu hình Web
1. Bấm nút **"Hệ thống"** ở góc phải màn hình.
2. Nhập địa chỉ IP, User và Password của Router.
3. Bấm **"+ Thêm đường truyền"** để định nghĩa các mạng bạn có.
4. Bấm **Lưu cấu hình**. Trang web sẽ tự động khởi động lại.
5. Bấm nút **"Cài đặt MikroTik"** để copy lệnh bật SNMP dán vào Terminal của Winbox là xong!

---

<h1 id="english-version">MikroTik Traffic Dashboard v3.0.1 (English)</h1>

MikroTik Traffic Dashboard is a lightweight, modern, and dynamic Node.js dashboard designed to monitor your MikroTik Router's WAN traffic (Download/Upload). Version 3.x introduces a massive upgrade: **A complete shift to SNMP**, fetching data directly from the router's RAM, ensuring zero NAND writes and significantly faster update intervals.

## ✨ New in v3.0.1 (Telegram Bot Integration)
- **Automated Telegram Reports**: Automatically compiles and sends daily traffic reports at exactly 00:00.
- **Monthly Reports**: Automatically sends a summarized monthly report on the 1st of every month at 00:01.
- **Hardware Agnostic**: Telegram reports now rely on the Dashboard's internal database. Swapping or rebooting your MikroTik router will no longer reset your historical reporting data.
- Fixed IPv6 connection issues when reaching the Telegram API.

## 🚀 Features
- **Real-time Monitoring**: Automatically fetches traffic snapshots.
- **Historical Analysis**: View traffic usage by **Hour**, **Day**, **Month**, and **Year**.
- **Interactive Charts**: Powered by Chart.js for beautiful, responsive data visualization.
- **Zero Database Setup**: Uses lightweight JSON flat-file storage (`history.json`, `hourly.json`).
- **Telegram Notifications**: Scheduled daily and monthly traffic summaries.

## ⚙️ Requirements
- **Node.js** (v14 or higher)
- **MikroTik RouterOS** (v6 or v7) with **SNMP** and **REST API** enabled.

## 🛠️ Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/manh9992/mikrotik-traffic-dashboard.git
   cd mikrotik-traffic-dashboard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configuration (Required for Telegram)**:
   Rename `config.example.json` to `config.json` and enter your Telegram Bot Token and Chat ID if you want to receive reports:
   ```bash
   cp config.example.json config.json
   nano config.json
   ```

4. **Start the server**:
   ```bash
   node server.js
   ```

5. **Access the Dashboard**:
   Open your browser and navigate to `http://<your-server-ip>:3001`.

## 🌐 Configuration Guide
1. Click on the **System Config** button on the top right.
2. Enter your Router's IP Address and REST API credentials.
3. Click **"+ Add Interface"** to define your WAN links.
4. Click **Save**. The dashboard will automatically reload.
5. Click the **"MikroTik Setup"** button to copy the command that enables SNMP on your router and paste it into Winbox.

## 📝 License
MIT License.
