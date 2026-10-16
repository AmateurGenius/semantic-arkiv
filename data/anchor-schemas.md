# Anchor namespace schemas

Probed: 2026-10-16T19:50:24.837Z
Chain-wide entity count: 10194

## mandi_board_v1 — 97 entities @ block 665086

### entity_type = price_report  (63)

| attribute | type(s) | sample |
| --- | --- | --- |
| crop | str | `potato` |
| mandi | str | `azadpur` |
| price | dec | `1514` |
| project | str | `mandi_board_v1` |
| reported_at_ms | u64 | `0x1a144c90ea4` |
| reporter | str | `demo_farmer_26` |
| state | str | `delhi` |
| synthetic | bool | `true` |
| type | str | `price_report` |

### entity_type = price_vote  (34)

| attribute | type(s) | sample |
| --- | --- | --- |
| project | str | `mandi_board_v1` |
| report_key | key | `0x4872347cb728a955c9f796298a76b923a79aa7` |
| type | str | `price_vote` |
| verdict | str | `confirm` |
| voted_at_ms | u64 | `0x1a144c96312` |
| voter | str | `demo_voter_026` |

## underthetable — 77 entities @ block 665086

### entity_type = report  (76)

| attribute | type(s) | sample |
| --- | --- | --- |
| amount_inr | u64 | `0x3` |
| day | str | `2026-10-16` |
| department | str | `ration` |
| district | str | `fatehpur` |
| kind | str | `diversion` |
| outcome | str | `noted` |
| project | str | `underthetable` |
| role | str | `public` |
| service | str | `grain_short` |
| source | str | `press` |
| state | str | `up` |
| type | str | `report` |
| week | str | `2026-W41` |

### entity_type = attestation  (1)

| attribute | type(s) | sample |
| --- | --- | --- |
| method | str | `geo` |
| project | str | `underthetable` |
| report | key | `0x647f040eda4574ca23db9312a54e2c632a9a80` |
| scope | str | `state` |
| state | str | `mh` |
| type | str | `attestation` |

## bhaiyaplease — 128 entities @ block 665086

### entity_type = delivery  (40)

| attribute | type(s) | sample |
| --- | --- | --- |
| project | str | `bhaiyaplease` |
| request | key | `0x6336756b7acbd7950b7e4a1f965ea35c4941c4` |
| resident | addr | `0x13be7bfb570ef7b1a136d7a3c19fb0ec454d84` |
| rider | addr | `0x280e00fd992aa5eec367846df3501858dcf955` |
| type | str | `delivery` |
| zone | str | `tdr3c1` |

### entity_type = request  (40)

| attribute | type(s) | sample |
| --- | --- | --- |
| code_commit | bytes32 | `0xe52de1950a25fc9e40315f403dd9503d26b493` |
| dest_zone | str | `tdr3c1` |
| max_price | i32 | `80` |
| project | str | `bhaiyaplease` |
| run | key | `0x587164c59294ae8f90315dadc8e7e9bf09adb1` |
| shop | key | `0x8732e536834f20e53935694b8845c4626f25d8` |
| tip | i32 | `10` |
| type | str | `request` |

### entity_type = receipt  (39)

| attribute | type(s) | sample |
| --- | --- | --- |
| at | u64 | `0x6ad17c59` |
| delivery | key | `0x25e49dcff6d46332058147ea683853e8b6ec78` |
| project | str | `bhaiyaplease` |
| rider | addr | `0x280e00fd992aa5eec367846df3501858dcf955` |
| type | str | `receipt` |
| zone | str | `tdr3c1` |

### entity_type = shop  (5)

| attribute | type(s) | sample |
| --- | --- | --- |
| category | str | `household` |
| name_tag | str | `Ghar Ka Saaman` |
| project | str | `bhaiyaplease` |
| type | str | `shop` |
| zone | str | `tdr3c1` |
| zone5 | str | `tdr3c` |

### entity_type = attestation  (3)

| attribute | type(s) | sample |
| --- | --- | --- |
| at | u64 | `0x6ad17a64` |
| level | str | `id_checked` |
| project | str | `bhaiyaplease` |
| subject | addr | `0x7b9c76f7d847dd5dd244507ce883fa51b8f2e3` |
| type | str | `attestation` |

### entity_type = complaint  (1)

| attribute | type(s) | sample |
| --- | --- | --- |
| at | u64 | `0x6ad17b91` |
| project | str | `bhaiyaplease` |
| reason | str | `wrong_item` |
| request | key | `0x8e6768abfe19fbb6fdcd509a2aba0f323fe635` |
| rider | addr | `0x7b9c76f7d847dd5dd244507ce883fa51b8f2e3` |
| type | str | `complaint` |
