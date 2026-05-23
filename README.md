# MikroTik Traffic Dashboard

A lightweight, near real-time traffic monitoring dashboard for MikroTik routers. It consists of two parts:
1. **MikroTik Scripts**: Runs on the router to capture traffic data and send daily/monthly reports via Telegram.
2. **Node.js Dashboard**: Runs on a separate Linux server to poll the router, store 30-day history, and serve a beautiful web UI.

---

## Part 1: MikroTik Setup

### 1. Create the Collector Script
This script collects data from `WAN_FPT` and `WAN_VIETTEL` interfaces and saves it to a file. 

Open **Winbox → System → Scripts → Add New**, name it `traffic-collector`, and paste this source:

```routeros
# ============================================================
# 1. SCRIPT COLLECTOR (Chay moi 10 phut)
# ============================================================
:local scriptName "traffic-collector"
:local mb 1048576

:local rxFpt [/interface get [find name="WAN_FPT"] rx-byte]
:local txFpt [/interface get [find name="WAN_FPT"] tx-byte]
:local rxVtl [/interface get [find name="WAN_VIETTEL"] rx-byte]
:local txVtl [/interface get [find name="WAN_VIETTEL"] tx-byte]

:global trafDayRxFpt; :global trafDayTxFpt
:global trafDayRxVtl; :global trafDayTxVtl

:if ([:typeof $trafDayRxFpt] = "nothing") do={
    :set trafDayRxFpt $rxFpt; :set trafDayTxFpt $txFpt
    :set trafDayRxVtl $rxVtl; :set trafDayTxVtl $txVtl
    :do { /file get [find name="traf-data.txt"] contents } on-error={ /file print file=traf-data where name=__none__; :delay 1s; /file set [find name="traf-data.txt"] contents="0,0,0,0,0,0,0,0" }
    :return
}

:local dRxF 0; :local dTxF 0
:local dRxV 0; :local dTxV 0

:if ($rxFpt >= $trafDayRxFpt) do={ :set dRxF (($rxFpt - $trafDayRxFpt) / 1024) } else={ :set dRxF ($rxFpt / 1024) }
:if ($txFpt >= $trafDayTxFpt) do={ :set dTxF (($txFpt - $trafDayTxFpt) / 1024) } else={ :set dTxF ($txFpt / 1024) }
:if ($rxVtl >= $trafDayRxVtl) do={ :set dRxV (($rxVtl - $trafDayRxVtl) / 1024) } else={ :set dRxV ($rxVtl / 1024) }
:if ($txVtl >= $trafDayTxVtl) do={ :set dTxV (($txVtl - $trafDayTxVtl) / 1024) } else={ :set dTxV ($txVtl / 1024) }

:local mRxF 0; :local mTxF 0
:local mRxV 0; :local mTxV 0

:do {
    :local mc [/file get [find name="traf-data.txt"] contents]
    :local arr [:toarray $mc]
    :if ([:len $arr] = 8) do={
        :set mRxF [:tonum [:pick $arr 4]]; :set mTxF [:tonum [:pick $arr 5]]
        :set mRxV [:tonum [:pick $arr 6]]; :set mTxV [:tonum [:pick $arr 7]]
    }
} on-error={}

:set mRxF ($mRxF + $dRxF); :set mTxF ($mTxF + $dTxF)
:set mRxV ($mRxV + $dRxV); :set mTxV ($mTxV + $dTxV)

/file set [find name="traf-data.txt"] contents="$dRxF,$dTxF,$dRxV,$dTxV,$mRxF,$mTxF,$mRxV,$mTxV"

:set trafDayRxFpt $rxFpt; :set trafDayTxFpt $txFpt
:set trafDayRxVtl $rxVtl; :set trafDayTxVtl $txVtl
```

Create a Scheduler to run it every 10 minutes:
```routeros
/system scheduler add name="schedule-traffic-collector" start-time=startup interval=10m on-event="/system script run traffic-collector"
```

### 2. Create the Reporter Script
This script sends the daily report via Telegram at 00:01 and clears the daily counters. On the 1st of every month, it also sends a monthly report and clears the monthly counters.

Name: `daily-traffic-report`

```routeros
# ============================================================
# 3. SCRIPT REPORTER (Chay 00:01 hang ngay - Ho tro RouterOS v7)
# ============================================================
:global telegramBotToken "YOUR_BOT_TOKEN"
:global telegramChatId "YOUR_CHAT_ID"

:local scriptName "daily-traffic-report"

:local data "0,0,0,0,0,0,0,0"
:do { :set data [/file get [find name="traf-data.txt"] contents] } on-error={}
:local arr [:toarray $data]

:if ([:len $arr] = 8) do={
    :local dRxF [:tonum [:pick $arr 0]]; :local dTxF [:tonum [:pick $arr 1]]
    :local dRxV [:tonum [:pick $arr 2]]; :local dTxV [:tonum [:pick $arr 3]]
    :local mRxF [:tonum [:pick $arr 4]]; :local mTxF [:tonum [:pick $arr 5]]
    :local mRxV [:tonum [:pick $arr 6]]; :local mTxV [:tonum [:pick $arr 7]]

    :local totDl ($dRxF + $dRxV); :local totUl ($dTxF + $dTxV); :local totAll ($totDl + $totUl)
    
    # --- TINH TOAN NGAY T-1 (Cho RouterOS v7 format: yyyy-mm-dd) ---
    :local dateNow [/system clock get date]
    :local yyyy [:tonum [:pick $dateNow 0 4]]
    :local mNum [:tonum [:pick $dateNow 5 7]]
    :local dd [:tonum [:pick $dateNow 8 10]]
    :local curDay [:pick $dateNow 8 10]

    :set dd ($dd - 1)
    :if ($dd = 0) do={
        :set mNum ($mNum - 1)
        :if ($mNum = 0) do={ :set mNum 12; :set yyyy ($yyyy - 1) }
        :if ($mNum=1 || $mNum=3 || $mNum=5 || $mNum=7 || $mNum=8 || $mNum=10 || $mNum=12) do={ :set dd 31 }
        :if ($mNum=4 || $mNum=6 || $mNum=9 || $mNum=11) do={ :set dd 30 }
        :if ($mNum=2) do={
            :if ((($yyyy % 4 = 0) && ($yyyy % 100 != 0)) || ($yyyy % 400 = 0)) do={ :set dd 29 } else={ :set dd 28 }
        }
    }
    :local ddStr [:tostr $dd]; :if ($dd < 10) do={ :set ddStr ("0" . $ddStr) }
    :local mmStr [:tostr $mNum]; :if ($mNum < 10) do={ :set mmStr ("0" . $mmStr) }
    :local yyyyStr [:tostr $yyyy]
    :local targetDate "$ddStr/$mmStr/$yyyyStr"

    :local identity [/system identity get name]
    :local uptime [/system resource get uptime]
    :local cpuLoad [/system resource get cpu-load]
    :local nl "\\n"

    :local toGb do={
        :local kb [:tonum $1]; :local gb ($kb / 1048576)
        :local rem ($kb % 1048576); :local dec (($rem * 10) / 1048576)
        :local decStr [:tostr $dec]; :if ([:len $decStr] = 0) do={ :set decStr "0" }
        :return ($gb . "." . $decStr . " GB")
    }

    # --- GUI BAO CAO NGAY ---
    :local dayMsg ""
    :set dayMsg ($dayMsg . "\F0\9F\93\8A B\C3\A1o c\C3\A1o l\C6\B0u l\C6\B0\E1\BB\A3ng internet ng\C3\A0y " . $targetDate . $nl)
    :set dayMsg ($dayMsg . "\F0\9F\96\A5 " . $identity . " | \E2\8F\B1 " . $uptime . " | CPU: " . $cpuLoad . "%" . $nl)
    :set dayMsg ($dayMsg . "\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80" . $nl)
    :set dayMsg ($dayMsg . "\F0\9F\8C\90 FPT: \E2\AC\87 " . [$toGb $dRxF] . "  \E2\AC\86 " . [$toGb $dTxF] . $nl)
    :set dayMsg ($dayMsg . "\F0\9F\8C\90 Viettel: \E2\AC\87 " . [$toGb $dRxV] . "  \E2\AC\86 " . [$toGb $dTxV] . $nl)
    :set dayMsg ($dayMsg . "\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80" . $nl)
    :set dayMsg ($dayMsg . "\F0\9F\93\A6 T\E1\BB\95ng: \E2\AC\87 " . [$toGb $totDl] . "  \E2\AC\86 " . [$toGb $totUl] . $nl)
    :set dayMsg ($dayMsg . "\F0\9F\92\BE T\E1\BB\95ng c\E1\BB\99ng: " . [$toGb $totAll])

    :local dayBody ("{\"chat_id\":\"" . $telegramChatId . "\",\"text\":\"" . $dayMsg . "\"}")
    /tool fetch http-method=post http-header-field="Content-Type: application/json" url=("https://api.telegram.org/bot" . $telegramBotToken . "/sendMessage") http-data=$dayBody keep-result=no

    # --- RESET DAILY TRONG FILE ---
    /file set [find name="traf-data.txt"] contents="0,0,0,0,$mRxF,$mTxF,$mRxV,$mTxV"

    # --- GUI BAO CAO THANG (Ngay 1) ---
    :if ($curDay = "01") do={
        :local monTotDl ($mRxF + $mRxV); :local monTotUl ($mTxF + $mTxV); :local monTotAll ($monTotDl + $monTotUl)
        
        :local pmStr "$mNum"; :if ($mNum < 10) do={ :set pmStr ("0" . $pmStr) }
        :local yyyyStrMon [:tostr $yyyy]

        :local monMsg ""
        :set monMsg ($monMsg . "\F0\9F\93\85 B\C3\A1o c\C3\A1o l\C6\B0u l\C6\B0\E1\BB\A3ng th\C3\A1ng " . $pmStr . "/" . $yyyyStrMon . $nl)
        :set monMsg ($monMsg . "\F0\9F\96\A5 " . $identity . " | \E2\8F\B1 " . $uptime . $nl)
        :set monMsg ($monMsg . "\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80" . $nl)
        :set monMsg ($monMsg . "\F0\9F\8C\90 FPT: \E2\AC\87 " . [$toGb $mRxF] . "  \E2\AC\86 " . [$toGb $mTxF] . $nl)
        :set monMsg ($monMsg . "\F0\9F\8C\90 Viettel: \E2\AC\87 " . [$toGb $mRxV] . "  \E2\AC\86 " . [$toGb $mTxV] . $nl)
        :set monMsg ($monMsg . "\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80\E2\94\80" . $nl)
        :set monMsg ($monMsg . "\F0\9F\93\A6 T\E1\BB\95ng: \E2\AC\87 " . [$toGb $monTotDl] . "  \E2\AC\86 " . [$toGb $monTotUl] . $nl)
        :set monMsg ($monMsg . "\F0\9F\92\BE T\E1\BB\95ng c\E1\BB\99ng: " . [$toGb $monTotAll])

        :local monBody ("{\"chat_id\":\"" . $telegramChatId . "\",\"text\":\"" . $monMsg . "\"}")
        /tool fetch http-method=post http-header-field="Content-Type: application/json" url=("https://api.telegram.org/bot" . $telegramBotToken . "/sendMessage") http-data=$monBody keep-result=no
        
        # --- RESET TAT CA VE 0 ---
        /file set [find name="traf-data.txt"] contents="0,0,0,0,0,0,0,0"
    }
} else={
    :log error "$scriptName: Data file bi loi!"
}
```

Create a Scheduler to run it every day at 00:01:
```routeros
/system scheduler add name="schedule-daily-traffic" start-time=00:01:00 interval=1d on-event="/system script run daily-traffic-report"
```

### 3. API Access User
Create a read-only user on the MikroTik to allow the dashboard to fetch the `traf-data.txt` file via REST API.
```routeros
/user group add name=api-read policy=read,api,!write,!policy,!test,!password,!sniff,!sensitive,!romon,!rest-api
/user add name=api-user password=YOUR_PASSWORD group=api-read allowed-address=YOUR_SERVER_IP
```
Make sure `www` or `api` service is enabled in `/ip services`.

---

## Part 2: Dashboard Server Setup

You need a Linux server with Node.js installed (e.g., Debian/Ubuntu).

1. Clone this repository or copy the files to `/opt/traffic-dashboard`.
2. Edit `server.js` and replace `YOUR_MIKROTIK_IP`, `YOUR_MIKROTIK_USER`, and `YOUR_MIKROTIK_PASSWORD` with the credentials created in Step 3 above.
3. Install dependencies:
   ```bash
   cd /opt/traffic-dashboard
   npm install
   ```
4. Setup systemd service to run it 24/7:
   ```bash
   # Copy the service file
   cp traffic-dashboard.service /etc/systemd/system/
   
   # Enable and start
   systemctl daemon-reload
   systemctl enable traffic-dashboard
   systemctl start traffic-dashboard
   ```
5. Access the dashboard via `http://YOUR_SERVER_IP:3001`
