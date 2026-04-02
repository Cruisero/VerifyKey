#!/bin/bash
# ============================================
# Device Spoofer - Mac ADB 版
# 替代 MiChanger 的设备信息更改功能
# 用法: bash device_spoof.sh [country]
# 默认国家: US
# ============================================

set -e

# 检查 ADB 连接
if ! adb devices | grep -q "device$"; then
    echo "❌ 未检测到 ADB 设备，请连接手机并开启 USB 调试"
    exit 1
fi

echo "✅ ADB 设备已连接"

# ============================================
# 随机数据生成函数
# ============================================

# 生成随机 IMEI (15位，符合 Pixel 设备 TAC)
generate_imei() {
    # Pixel 设备的 TAC 前缀
    local tacs=("35332172" "35516110" "35900911" "35455311" "35256811")
    local tac=${tacs[$((RANDOM % ${#tacs[@]}))]}
    local serial=$(printf "%06d" $((RANDOM % 999999)))
    local imei_without_check="${tac}${serial}"
    
    # 计算 Luhn 校验位
    local sum=0
    local len=${#imei_without_check}
    for ((i = 0; i < len; i++)); do
        local digit=${imei_without_check:$i:1}
        if (( (len - i) % 2 == 0 )); then
            digit=$((digit * 2))
            if ((digit > 9)); then
                digit=$((digit - 9))
            fi
        fi
        sum=$((sum + digit))
    done
    local check=$(( (10 - (sum % 10)) % 10 ))
    echo "${imei_without_check}${check}"
}

# 生成随机美国电话号码
generate_phone() {
    local area_codes=("212" "310" "415" "305" "702" "206" "512" "404" "617" "602" "503" "916" "614" "469" "813")
    local area=${area_codes[$((RANDOM % ${#area_codes[@]}))]}
    local mid=$(printf "%03d" $((RANDOM % 900 + 100)))
    local last=$(printf "%04d" $((RANDOM % 10000)))
    echo "+1${area}${mid}${last}"
}

# 生成随机 ICCID (19-20位)
generate_iccid() {
    local mcc_mnc=("310260" "310410" "311480" "312090" "310120" "312530")
    local prefix="89"
    local mn=${mcc_mnc[$((RANDOM % ${#mcc_mnc[@]}))]}
    local serial=$(printf "%010d" $((RANDOM % 9999999999)))
    echo "${prefix}${mn}${serial}"
}

# 生成随机 IMSI (SIM用户ID, 15位)
generate_imsi() {
    local mcc_mnc=("310260" "310410" "311480" "312090" "310120")
    local mn=${mcc_mnc[$((RANDOM % ${#mcc_mnc[@]}))]}
    local serial=$(printf "%09d" $((RANDOM % 999999999)))
    echo "${mn}${serial}"
}

# 生成随机 MAC 地址
generate_mac() {
    printf "%02x:%02x:%02x:%02x:%02x:%02x" \
        $((RANDOM % 256 & 0xFE | 0x02)) \
        $((RANDOM % 256)) \
        $((RANDOM % 256)) \
        $((RANDOM % 256)) \
        $((RANDOM % 256)) \
        $((RANDOM % 256))
}

# 生成随机 WiFi 名称
generate_wifi() {
    local prefixes=("NETGEAR" "Linksys" "ATT" "Spectrum" "Xfinity" "TP-Link" "ASUS" "Verizon" "CenturyLink" "Buffalo" "HOME" "MyWiFi" "FamilyNet")
    local suffixes=("5G" "Plus" "Guest" "Home" "Network" "")
    local numbers=$((RANDOM % 9999))
    local prefix=${prefixes[$((RANDOM % ${#prefixes[@]}))]}
    local suffix=${suffixes[$((RANDOM % ${#suffixes[@]}))]}
    echo "${prefix}_${numbers}${suffix}"
}

# 生成随机美国坐标
generate_location() {
    # 美国主要城市坐标范围
    local cities=(
        "40.7128:-74.0060"   # New York
        "34.0522:-118.2437"  # Los Angeles
        "41.8781:-87.6298"   # Chicago  
        "29.7604:-95.3698"   # Houston
        "33.4484:-112.0740"  # Phoenix
        "29.4241:-98.4936"   # San Antonio
        "32.7157:-117.1611"  # San Diego
        "30.2672:-97.7431"   # Austin
        "37.7749:-122.4194"  # San Francisco
        "47.6062:-122.3321"  # Seattle
        "33.7490:-84.3880"   # Atlanta
        "39.7392:-104.9903"  # Denver
    )
    local city=${cities[$((RANDOM % ${#cities[@]}))]}
    local base_lat=$(echo "$city" | cut -d: -f1)
    local base_lon=$(echo "$city" | cut -d: -f2)
    
    # 添加小偏移 (±0.05度，约5公里范围)
    local lat_offset=$(awk "BEGIN{srand($RANDOM); printf \"%.6f\", (rand()-0.5)*0.1}")
    local lon_offset=$(awk "BEGIN{srand($RANDOM); printf \"%.6f\", (rand()-0.5)*0.1}")
    local lat=$(awk "BEGIN{printf \"%.10f\", $base_lat + $lat_offset}")
    local lon=$(awk "BEGIN{printf \"%.10f\", $base_lon + $lon_offset}")
    
    echo "${lat}:${lon}"
}

# 获取随机美国运营商
get_carrier_info() {
    local carriers=(
        "310260:T-Mobile:T-Mobile"
        "310410:AT&T:AT&T"
        "311480:Verizon:Verizon Wireless"
        "312090:Aeris:Aeris Comm. Inc."
        "310120:Sprint:Sprint"
        "312530:Google Fi:Google Fi"
    )
    echo "${carriers[$((RANDOM % ${#carriers[@]}))]}"
}

# ============================================
# 生成所有随机数据
# ============================================

IMEI=$(generate_imei)
PHONE=$(generate_phone)
ICCID=$(generate_iccid)
IMSI=$(generate_imsi)
MAC=$(generate_mac)
WIFI=$(generate_wifi)
LOCATION=$(generate_location)
LAT=$(echo "$LOCATION" | cut -d: -f1)
LON=$(echo "$LOCATION" | cut -d: -f2)

CARRIER_INFO=$(get_carrier_info)
MCC_MNC=$(echo "$CARRIER_INFO" | cut -d: -f1)
CARRIER_SHORT=$(echo "$CARRIER_INFO" | cut -d: -f2)
CARRIER_FULL=$(echo "$CARRIER_INFO" | cut -d: -f3)
SIM_CODE=$(echo "$MCC_MNC" | head -c 6)

# 美国时区列表
TIMEZONES=("America/New_York" "America/Chicago" "America/Denver" "America/Los_Angeles" "America/Phoenix")
TIMEZONE=${TIMEZONES[$((RANDOM % ${#TIMEZONES[@]}))]}

echo ""
echo "=========================================="
echo "   📱 新设备信息"
echo "=========================================="
echo "  品牌:      Google"
echo "  型号:      Pixel 10 Pro"
echo "  名称:      Google Pixel 10 Pro Global"
echo "  Android:   16"
echo "  IMEI:      $IMEI"
echo "  SIM代码:   $SIM_CODE"
echo "  ICCID:     $ICCID"
echo "  SIM用户ID: $IMSI"
echo "  电话号码:  $PHONE"
echo "  运营商:    $CARRIER_FULL"
echo "  纬度:      $LAT"
echo "  经度:      $LON"
echo "  WiFi名称:  $WIFI"
echo "  MAC地址:   $MAC"
echo "  时区:      $TIMEZONE"
echo "=========================================="
echo ""

read -p "确认更改？(y/n): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "已取消"
    exit 0
fi

echo ""
echo "🔧 正在更改设备信息..."

# ============================================
# 1. 设备基本信息 (通过 system props)
# ============================================
echo "  [1/8] 设置设备型号..."
adb shell su -c "setprop ro.product.model 'Pixel 10 Pro'"
adb shell su -c "setprop ro.product.brand google"
adb shell su -c "setprop ro.product.manufacturer Google"
adb shell su -c "setprop ro.product.device blazer"
adb shell su -c "setprop ro.product.name blazer"
adb shell su -c "setprop ro.build.display.id 'BP31.250224.012'"
adb shell su -c "setprop ro.build.version.release 16"
adb shell su -c "setprop ro.build.product blazer"

# ============================================
# 2. SIM 和运营商信息
# ============================================
echo "  [2/8] 设置 SIM/运营商信息..."
adb shell su -c "setprop gsm.operator.alpha '$CARRIER_SHORT'"
adb shell su -c "setprop gsm.operator.numeric '$MCC_MNC'"
adb shell su -c "setprop gsm.operator.iso-country us"
adb shell su -c "setprop gsm.sim.operator.alpha '$CARRIER_FULL'"
adb shell su -c "setprop gsm.sim.operator.numeric '$MCC_MNC'"
adb shell su -c "setprop gsm.sim.operator.iso-country us"
adb shell su -c "setprop gsm.sim.state READY"
adb shell su -c "setprop persist.sys.language en"
adb shell su -c "setprop persist.sys.country US"

# ============================================
# 3. 时区
# ============================================
echo "  [3/8] 设置时区..."
adb shell su -c "setprop persist.sys.timezone '$TIMEZONE'"
adb shell su -c "settings put global auto_time_zone 0"

# ============================================
# 4. IMEI (通过属性设置)
# ============================================
echo "  [4/8] 设置 IMEI..."
adb shell su -c "setprop persist.radio.device.imei '$IMEI'"
adb shell su -c "setprop gsm.imei '$IMEI'"

# ============================================
# 5. MAC 地址
# ============================================
echo "  [5/8] 设置 MAC 地址..."
adb shell su -c "ip link set wlan0 down" 2>/dev/null || true
adb shell su -c "ip link set wlan0 address '$MAC'" 2>/dev/null || true
adb shell su -c "ip link set wlan0 up" 2>/dev/null || true
adb shell su -c "setprop persist.wifi.mac '$MAC'"

# ============================================
# 6. WiFi 名称 (通过属性)
# ============================================
echo "  [6/8] 设置 WiFi 名称..."
adb shell su -c "setprop wifi.interface.ssid '$WIFI'"

# ============================================
# 7. GPS 位置 (写入设置)
# ============================================
echo "  [7/8] 设置 GPS 位置..."
adb shell su -c "settings put secure location_mode 0"
adb shell su -c "setprop persist.location.latitude '$LAT'"
adb shell su -c "setprop persist.location.longitude '$LON'"

# ============================================
# 8. 清除 Google 数据 + 重置 Android ID
# ============================================
echo "  [8/8] 清除 Google 数据..."
adb shell su -c "am force-stop com.google.android.gms"
adb shell su -c "am force-stop com.android.vending"
adb shell su -c "am force-stop com.google.android.apps.subscriptions.red"
adb shell su -c "am force-stop com.google.android.gsf"
adb shell su -c "pm clear com.google.android.gms"
adb shell su -c "pm clear com.android.vending"
adb shell su -c "pm clear com.google.android.apps.subscriptions.red"
adb shell su -c "pm clear com.google.android.gsf"
adb shell su -c "settings delete secure android_id"

echo ""
echo "=========================================="
echo "   ✅ 设备信息更改完成！"
echo "=========================================="
echo ""
echo "接下来手动操作："
echo "  1. 设置 → 账户 → 移除旧 Google 账号"
echo "  2. 登录新 Google 账号"
echo "  3. 打开 Google One 查看福利"
echo ""
echo "⚠️  注意：IMEI 通过属性设置可能不够完整"
echo "    如果不生效，IMEI 部分仍需使用 MiChanger"
echo ""
