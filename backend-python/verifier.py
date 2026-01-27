"""
SheerID Verifier with Anti-Detection
Uses curl_cffi for TLS fingerprint spoofing
"""

import re
import random
import os
from typing import Optional, Dict, Tuple, Callable

from anti_detect import (
    create_session, get_headers, get_fingerprint, 
    random_delay, warm_session
)

SHEERID_API_URL = "https://services.sheerid.com/rest/v2"

# Google One Student Verification Program ID (from ThanhNguyxn)
PROGRAM_ID = "67c8c14f5f17a83b745e3f82"

# US Universities with VERIFIED SheerID IDs (from ThanhNguyxn/SheerID-Verification-Tool)
# These IDs are confirmed to work with high success rates
UNIVERSITIES = [
    # ============================================
    # UNITED STATES
    # ============================================
    {"id": 2565, "idExtended": "2565", "name": "Pennsylvania State University-Main Campus", "domain": "psu.edu", "country": "US", "weight": 100},
    {"id": 3499, "idExtended": "3499", "name": "University of California, Los Angeles", "domain": "ucla.edu", "country": "US", "weight": 98},
    {"id": 3491, "idExtended": "3491", "name": "University of California, Berkeley", "domain": "berkeley.edu", "country": "US", "weight": 97},
    {"id": 1953, "idExtended": "1953", "name": "Massachusetts Institute of Technology", "domain": "mit.edu", "country": "US", "weight": 95},
    {"id": 3113, "idExtended": "3113", "name": "Stanford University", "domain": "stanford.edu", "country": "US", "weight": 95},
    {"id": 2285, "idExtended": "2285", "name": "New York University", "domain": "nyu.edu", "country": "US", "weight": 96},
    {"id": 1426, "idExtended": "1426", "name": "Harvard University", "domain": "harvard.edu", "country": "US", "weight": 92},
    {"id": 590759, "idExtended": "590759", "name": "Yale University", "domain": "yale.edu", "country": "US", "weight": 90},
    {"id": 2626, "idExtended": "2626", "name": "Princeton University", "domain": "princeton.edu", "country": "US", "weight": 90},
    {"id": 698, "idExtended": "698", "name": "Columbia University", "domain": "columbia.edu", "country": "US", "weight": 92},
    {"id": 3508, "idExtended": "3508", "name": "University of Chicago", "domain": "uchicago.edu", "country": "US", "weight": 88},
    {"id": 943, "idExtended": "943", "name": "Duke University", "domain": "duke.edu", "country": "US", "weight": 88},
    {"id": 751, "idExtended": "751", "name": "Cornell University", "domain": "cornell.edu", "country": "US", "weight": 90},
    {"id": 2420, "idExtended": "2420", "name": "Northwestern University", "domain": "northwestern.edu", "country": "US", "weight": 88},
    {"id": 3568, "idExtended": "3568", "name": "University of Michigan", "domain": "umich.edu", "country": "US", "weight": 95},
    {"id": 3686, "idExtended": "3686", "name": "University of Texas at Austin", "domain": "utexas.edu", "country": "US", "weight": 94},
    {"id": 1314, "idExtended": "1314", "name": "Georgia Institute of Technology-Main Campus (Atlanta, GA)", "domain": "gatech.edu", "country": "US", "weight": 93},
    {"id": 602, "idExtended": "602", "name": "Carnegie Mellon University", "domain": "cmu.edu", "country": "US", "weight": 92},
    {"id": 3477, "idExtended": "3477", "name": "University of California, San Diego", "domain": "ucsd.edu", "country": "US", "weight": 93},
    {"id": 650865, "idExtended": "650865", "name": "Arizona State University (Glendale, AZ)", "domain": "asu.edu", "country": "US", "weight": 92},
    {"id": 2874, "idExtended": "2874", "name": "Santa Monica College", "domain": "smc.edu", "country": "US", "weight": 85},
    {"id": 2350, "idExtended": "2350", "name": "Northern Virginia Community College", "domain": "nvcc.edu", "country": "US", "weight": 84},
    
    # ============================================
    # ARGENTINA
    # ============================================
    {"id": 0, "idExtended": "AR-UBA", "name": "Universidad de Buenos Aires", "domain": "uba.ar", "country": "AR", "weight": 80},
    {"id": 0, "idExtended": "AR-UNC", "name": "Universidad Nacional de Córdoba", "domain": "unc.edu.ar", "country": "AR", "weight": 75},
    {"id": 0, "idExtended": "AR-UNLP", "name": "Universidad Nacional de La Plata", "domain": "unlp.edu.ar", "country": "AR", "weight": 70},
    
    # ============================================
    # AUSTRALIA
    # ============================================
    {"id": 0, "idExtended": "AU-USYD", "name": "University of Sydney", "domain": "sydney.edu.au", "country": "AU", "weight": 85},
    {"id": 0, "idExtended": "AU-UMELB", "name": "University of Melbourne", "domain": "unimelb.edu.au", "country": "AU", "weight": 85},
    {"id": 0, "idExtended": "AU-ANU", "name": "Australian National University", "domain": "anu.edu.au", "country": "AU", "weight": 82},
    {"id": 0, "idExtended": "AU-UNSW", "name": "University of New South Wales", "domain": "unsw.edu.au", "country": "AU", "weight": 80},
    {"id": 0, "idExtended": "AU-UQ", "name": "University of Queensland", "domain": "uq.edu.au", "country": "AU", "weight": 80},
    
    # ============================================
    # AUSTRIA
    # ============================================
    {"id": 0, "idExtended": "AT-UNIVIE", "name": "University of Vienna", "domain": "univie.ac.at", "country": "AT", "weight": 80},
    {"id": 0, "idExtended": "AT-TUW", "name": "Vienna University of Technology", "domain": "tuwien.ac.at", "country": "AT", "weight": 78},
    
    # ============================================
    # BANGLADESH
    # ============================================
    {"id": 0, "idExtended": "BD-DU", "name": "University of Dhaka", "domain": "du.ac.bd", "country": "BD", "weight": 75},
    {"id": 0, "idExtended": "BD-BUET", "name": "Bangladesh University of Engineering and Technology", "domain": "buet.ac.bd", "country": "BD", "weight": 75},
    {"id": 0, "idExtended": "BD-NSU", "name": "North South University", "domain": "northsouth.edu", "country": "BD", "weight": 70},
    
    # ============================================
    # BELGIUM
    # ============================================
    {"id": 0, "idExtended": "BE-KULEUVEN", "name": "KU Leuven", "domain": "kuleuven.be", "country": "BE", "weight": 82},
    {"id": 0, "idExtended": "BE-ULB", "name": "Université Libre de Bruxelles", "domain": "ulb.ac.be", "country": "BE", "weight": 78},
    
    # ============================================
    # BOLIVIA
    # ============================================
    {"id": 0, "idExtended": "BO-UMSA", "name": "Universidad Mayor de San Andrés", "domain": "umsa.bo", "country": "BO", "weight": 70},
    
    # ============================================
    # BULGARIA
    # ============================================
    {"id": 0, "idExtended": "BG-SU", "name": "Sofia University", "domain": "uni-sofia.bg", "country": "BG", "weight": 72},
    
    # ============================================
    # CANADA
    # ============================================
    {"id": 0, "idExtended": "CA-UTORONTO", "name": "University of Toronto", "domain": "utoronto.ca", "country": "CA", "weight": 88},
    {"id": 0, "idExtended": "CA-UBC", "name": "University of British Columbia", "domain": "ubc.ca", "country": "CA", "weight": 85},
    {"id": 0, "idExtended": "CA-MCGILL", "name": "McGill University", "domain": "mcgill.ca", "country": "CA", "weight": 85},
    {"id": 0, "idExtended": "CA-UWATERLOO", "name": "University of Waterloo", "domain": "uwaterloo.ca", "country": "CA", "weight": 82},
    
    # ============================================
    # CHILE
    # ============================================
    {"id": 0, "idExtended": "CL-UCHILE", "name": "Universidad de Chile", "domain": "uchile.cl", "country": "CL", "weight": 78},
    {"id": 0, "idExtended": "CL-PUC", "name": "Pontificia Universidad Católica de Chile", "domain": "uc.cl", "country": "CL", "weight": 78},
    
    # ============================================
    # CZECH REPUBLIC
    # ============================================
    {"id": 0, "idExtended": "CZ-CUNI", "name": "Charles University", "domain": "cuni.cz", "country": "CZ", "weight": 78},
    {"id": 0, "idExtended": "CZ-CTU", "name": "Czech Technical University in Prague", "domain": "cvut.cz", "country": "CZ", "weight": 75},
    
    # ============================================
    # DENMARK
    # ============================================
    {"id": 0, "idExtended": "DK-KU", "name": "University of Copenhagen", "domain": "ku.dk", "country": "DK", "weight": 82},
    {"id": 0, "idExtended": "DK-DTU", "name": "Technical University of Denmark", "domain": "dtu.dk", "country": "DK", "weight": 80},
    
    # ============================================
    # DOMINICAN REPUBLIC
    # ============================================
    {"id": 0, "idExtended": "DO-UASD", "name": "Universidad Autónoma de Santo Domingo", "domain": "uasd.edu.do", "country": "DO", "weight": 70},
    
    # ============================================
    # ECUADOR
    # ============================================
    {"id": 0, "idExtended": "EC-UCE", "name": "Universidad Central del Ecuador", "domain": "uce.edu.ec", "country": "EC", "weight": 70},
    {"id": 0, "idExtended": "EC-ESPOL", "name": "Escuela Superior Politécnica del Litoral", "domain": "espol.edu.ec", "country": "EC", "weight": 72},
    
    # ============================================
    # EL SALVADOR
    # ============================================
    {"id": 0, "idExtended": "SV-UES", "name": "Universidad de El Salvador", "domain": "ues.edu.sv", "country": "SV", "weight": 68},
    
    # ============================================
    # FINLAND
    # ============================================
    {"id": 0, "idExtended": "FI-HELSINKI", "name": "University of Helsinki", "domain": "helsinki.fi", "country": "FI", "weight": 82},
    {"id": 0, "idExtended": "FI-AALTO", "name": "Aalto University", "domain": "aalto.fi", "country": "FI", "weight": 80},
    
    # ============================================
    # FRANCE
    # ============================================
    {"id": 0, "idExtended": "FR-SORBONNE", "name": "Sorbonne University", "domain": "sorbonne-universite.fr", "country": "FR", "weight": 85},
    {"id": 0, "idExtended": "FR-PSL", "name": "Paris Sciences et Lettres University", "domain": "psl.eu", "country": "FR", "weight": 83},
    {"id": 0, "idExtended": "FR-POLYTECHNIQUE", "name": "École Polytechnique", "domain": "polytechnique.edu", "country": "FR", "weight": 85},
    
    # ============================================
    # GHANA
    # ============================================
    {"id": 0, "idExtended": "GH-UG", "name": "University of Ghana", "domain": "ug.edu.gh", "country": "GH", "weight": 70},
    {"id": 0, "idExtended": "GH-KNUST", "name": "Kwame Nkrumah University of Science and Technology", "domain": "knust.edu.gh", "country": "GH", "weight": 70},
    
    # ============================================
    # GREECE
    # ============================================
    {"id": 0, "idExtended": "GR-UOA", "name": "National and Kapodistrian University of Athens", "domain": "uoa.gr", "country": "GR", "weight": 75},
    {"id": 0, "idExtended": "GR-AUTH", "name": "Aristotle University of Thessaloniki", "domain": "auth.gr", "country": "GR", "weight": 75},
    
    # ============================================
    # GUATEMALA
    # ============================================
    {"id": 0, "idExtended": "GT-USAC", "name": "Universidad de San Carlos de Guatemala", "domain": "usac.edu.gt", "country": "GT", "weight": 68},
    
    # ============================================
    # HUNGARY
    # ============================================
    {"id": 0, "idExtended": "HU-ELTE", "name": "Eötvös Loránd University", "domain": "elte.hu", "country": "HU", "weight": 75},
    {"id": 0, "idExtended": "HU-BME", "name": "Budapest University of Technology and Economics", "domain": "bme.hu", "country": "HU", "weight": 75},
    
    # ============================================
    # IRAQ
    # ============================================
    {"id": 0, "idExtended": "IQ-UOB", "name": "University of Baghdad", "domain": "uobaghdad.edu.iq", "country": "IQ", "weight": 68},
    
    # ============================================
    # ISRAEL
    # ============================================
    {"id": 0, "idExtended": "IL-HUJI", "name": "Hebrew University of Jerusalem", "domain": "huji.ac.il", "country": "IL", "weight": 82},
    {"id": 0, "idExtended": "IL-TECHNION", "name": "Technion - Israel Institute of Technology", "domain": "technion.ac.il", "country": "IL", "weight": 85},
    {"id": 0, "idExtended": "IL-TAU", "name": "Tel Aviv University", "domain": "tau.ac.il", "country": "IL", "weight": 82},
    
    # ============================================
    # ITALY
    # ============================================
    {"id": 0, "idExtended": "IT-UNIMI", "name": "University of Milan", "domain": "unimi.it", "country": "IT", "weight": 80},
    {"id": 0, "idExtended": "IT-POLIMI", "name": "Politecnico di Milano", "domain": "polimi.it", "country": "IT", "weight": 82},
    {"id": 0, "idExtended": "IT-UNIBO", "name": "University of Bologna", "domain": "unibo.it", "country": "IT", "weight": 80},
    {"id": 0, "idExtended": "IT-UNIROMA1", "name": "Sapienza University of Rome", "domain": "uniroma1.it", "country": "IT", "weight": 80},
    
    # ============================================
    # JORDAN
    # ============================================
    {"id": 0, "idExtended": "JO-UJ", "name": "University of Jordan", "domain": "ju.edu.jo", "country": "JO", "weight": 72},
    
    # ============================================
    # KENYA
    # ============================================
    {"id": 0, "idExtended": "KE-UON", "name": "University of Nairobi", "domain": "uonbi.ac.ke", "country": "KE", "weight": 72},
    {"id": 0, "idExtended": "KE-KU", "name": "Kenyatta University", "domain": "ku.ac.ke", "country": "KE", "weight": 70},
    
    # ============================================
    # MALAYSIA
    # ============================================
    {"id": 0, "idExtended": "MY-UM", "name": "University of Malaya", "domain": "um.edu.my", "country": "MY", "weight": 78},
    {"id": 0, "idExtended": "MY-UKM", "name": "National University of Malaysia", "domain": "ukm.my", "country": "MY", "weight": 75},
    {"id": 0, "idExtended": "MY-USM", "name": "Universiti Sains Malaysia", "domain": "usm.my", "country": "MY", "weight": 75},
    
    # ============================================
    # MOROCCO
    # ============================================
    {"id": 0, "idExtended": "MA-UM5", "name": "Mohammed V University", "domain": "um5.ac.ma", "country": "MA", "weight": 70},
    
    # ============================================
    # NETHERLANDS
    # ============================================
    {"id": 0, "idExtended": "NL-UVA", "name": "University of Amsterdam", "domain": "uva.nl", "country": "NL", "weight": 82},
    {"id": 0, "idExtended": "NL-TUD", "name": "Delft University of Technology", "domain": "tudelft.nl", "country": "NL", "weight": 82},
    {"id": 0, "idExtended": "NL-LEI", "name": "Leiden University", "domain": "leidenuniv.nl", "country": "NL", "weight": 80},
    
    # ============================================
    # NICARAGUA
    # ============================================
    {"id": 0, "idExtended": "NI-UNAN", "name": "Universidad Nacional Autónoma de Nicaragua", "domain": "unan.edu.ni", "country": "NI", "weight": 65},
    
    # ============================================
    # NIGERIA
    # ============================================
    {"id": 0, "idExtended": "NG-UI", "name": "University of Ibadan", "domain": "ui.edu.ng", "country": "NG", "weight": 72},
    {"id": 0, "idExtended": "NG-UNILAG", "name": "University of Lagos", "domain": "unilag.edu.ng", "country": "NG", "weight": 72},
    {"id": 0, "idExtended": "NG-ABU", "name": "Ahmadu Bello University", "domain": "abu.edu.ng", "country": "NG", "weight": 70},
    
    # ============================================
    # PAKISTAN
    # ============================================
    {"id": 0, "idExtended": "PK-QAU", "name": "Quaid-i-Azam University", "domain": "qau.edu.pk", "country": "PK", "weight": 72},
    {"id": 0, "idExtended": "PK-LUMS", "name": "Lahore University of Management Sciences", "domain": "lums.edu.pk", "country": "PK", "weight": 75},
    {"id": 0, "idExtended": "PK-NUST", "name": "National University of Sciences and Technology", "domain": "nust.edu.pk", "country": "PK", "weight": 75},
    
    # ============================================
    # PERU
    # ============================================
    {"id": 0, "idExtended": "PE-PUCP", "name": "Pontificia Universidad Católica del Perú", "domain": "pucp.edu.pe", "country": "PE", "weight": 75},
    {"id": 0, "idExtended": "PE-UNMSM", "name": "Universidad Nacional Mayor de San Marcos", "domain": "unmsm.edu.pe", "country": "PE", "weight": 72},
    
    # ============================================
    # PHILIPPINES
    # ============================================
    {"id": 0, "idExtended": "PH-UP", "name": "University of the Philippines", "domain": "up.edu.ph", "country": "PH", "weight": 75},
    {"id": 0, "idExtended": "PH-ATENEO", "name": "Ateneo de Manila University", "domain": "ateneo.edu", "country": "PH", "weight": 75},
    {"id": 0, "idExtended": "PH-DLSU", "name": "De La Salle University", "domain": "dlsu.edu.ph", "country": "PH", "weight": 72},
    
    # ============================================
    # POLAND
    # ============================================
    {"id": 0, "idExtended": "PL-UW", "name": "University of Warsaw", "domain": "uw.edu.pl", "country": "PL", "weight": 78},
    {"id": 0, "idExtended": "PL-AGH", "name": "AGH University of Science and Technology", "domain": "agh.edu.pl", "country": "PL", "weight": 75},
    {"id": 0, "idExtended": "PL-PWR", "name": "Wrocław University of Science and Technology", "domain": "pwr.edu.pl", "country": "PL", "weight": 75},
    
    # ============================================
    # PORTUGAL
    # ============================================
    {"id": 0, "idExtended": "PT-UL", "name": "University of Lisbon", "domain": "ulisboa.pt", "country": "PT", "weight": 78},
    {"id": 0, "idExtended": "PT-UP", "name": "University of Porto", "domain": "up.pt", "country": "PT", "weight": 78},
    
    # ============================================
    # ROMANIA
    # ============================================
    {"id": 0, "idExtended": "RO-UB", "name": "University of Bucharest", "domain": "unibuc.ro", "country": "RO", "weight": 72},
    {"id": 0, "idExtended": "RO-UPB", "name": "Politehnica University of Bucharest", "domain": "upb.ro", "country": "RO", "weight": 72},
    
    # ============================================
    # RWANDA
    # ============================================
    {"id": 0, "idExtended": "RW-UR", "name": "University of Rwanda", "domain": "ur.ac.rw", "country": "RW", "weight": 65},
    
    # ============================================
    # SINGAPORE
    # ============================================
    {"id": 0, "idExtended": "SG-NUS", "name": "National University of Singapore", "domain": "nus.edu.sg", "country": "SG", "weight": 88},
    {"id": 0, "idExtended": "SG-NTU", "name": "Nanyang Technological University", "domain": "ntu.edu.sg", "country": "SG", "weight": 85},
    
    # ============================================
    # SOUTH AFRICA
    # ============================================
    {"id": 0, "idExtended": "ZA-UCT", "name": "University of Cape Town", "domain": "uct.ac.za", "country": "ZA", "weight": 80},
    {"id": 0, "idExtended": "ZA-WITS", "name": "University of the Witwatersrand", "domain": "wits.ac.za", "country": "ZA", "weight": 78},
    {"id": 0, "idExtended": "ZA-SU", "name": "Stellenbosch University", "domain": "sun.ac.za", "country": "ZA", "weight": 78},
    
    # ============================================
    # SPAIN
    # ============================================
    {"id": 0, "idExtended": "ES-UB", "name": "University of Barcelona", "domain": "ub.edu", "country": "ES", "weight": 80},
    {"id": 0, "idExtended": "ES-UAM", "name": "Universidad Autónoma de Madrid", "domain": "uam.es", "country": "ES", "weight": 78},
    {"id": 0, "idExtended": "ES-UPM", "name": "Universidad Politécnica de Madrid", "domain": "upm.es", "country": "ES", "weight": 78},
    
    # ============================================
    # SRI LANKA
    # ============================================
    {"id": 0, "idExtended": "LK-UCOL", "name": "University of Colombo", "domain": "cmb.ac.lk", "country": "LK", "weight": 70},
    {"id": 0, "idExtended": "LK-UOP", "name": "University of Peradeniya", "domain": "pdn.ac.lk", "country": "LK", "weight": 70},
    
    # ============================================
    # SWEDEN
    # ============================================
    {"id": 0, "idExtended": "SE-KTH", "name": "KTH Royal Institute of Technology", "domain": "kth.se", "country": "SE", "weight": 82},
    {"id": 0, "idExtended": "SE-LU", "name": "Lund University", "domain": "lu.se", "country": "SE", "weight": 82},
    {"id": 0, "idExtended": "SE-UU", "name": "Uppsala University", "domain": "uu.se", "country": "SE", "weight": 80},
    
    # ============================================
    # SWITZERLAND
    # ============================================
    {"id": 0, "idExtended": "CH-ETH", "name": "ETH Zurich", "domain": "ethz.ch", "country": "CH", "weight": 90},
    {"id": 0, "idExtended": "CH-EPFL", "name": "École Polytechnique Fédérale de Lausanne", "domain": "epfl.ch", "country": "CH", "weight": 88},
    {"id": 0, "idExtended": "CH-UZH", "name": "University of Zurich", "domain": "uzh.ch", "country": "CH", "weight": 82},
    
    # ============================================
    # TAIWAN
    # ============================================
    {"id": 0, "idExtended": "TW-NTU", "name": "National Taiwan University", "domain": "ntu.edu.tw", "country": "TW", "weight": 85},
    {"id": 0, "idExtended": "TW-NTHU", "name": "National Tsing Hua University", "domain": "nthu.edu.tw", "country": "TW", "weight": 82},
    {"id": 0, "idExtended": "TW-NCTU", "name": "National Yang Ming Chiao Tung University", "domain": "nycu.edu.tw", "country": "TW", "weight": 80},
    
    # ============================================
    # THAILAND
    # ============================================
    {"id": 0, "idExtended": "TH-CU", "name": "Chulalongkorn University", "domain": "chula.ac.th", "country": "TH", "weight": 78},
    {"id": 0, "idExtended": "TH-MU", "name": "Mahidol University", "domain": "mahidol.ac.th", "country": "TH", "weight": 75},
    {"id": 0, "idExtended": "TH-KU", "name": "Kasetsart University", "domain": "ku.ac.th", "country": "TH", "weight": 72},
    
    # ============================================
    # TURKEY
    # ============================================
    {"id": 0, "idExtended": "TR-BOUN", "name": "Boğaziçi University", "domain": "boun.edu.tr", "country": "TR", "weight": 80},
    {"id": 0, "idExtended": "TR-METU", "name": "Middle East Technical University", "domain": "metu.edu.tr", "country": "TR", "weight": 80},
    {"id": 0, "idExtended": "TR-ITU", "name": "Istanbul Technical University", "domain": "itu.edu.tr", "country": "TR", "weight": 78},
    
    # ============================================
    # UKRAINE
    # ============================================
    {"id": 0, "idExtended": "UA-KNU", "name": "Taras Shevchenko National University of Kyiv", "domain": "knu.ua", "country": "UA", "weight": 75},
    {"id": 0, "idExtended": "UA-NTUU", "name": "Igor Sikorsky Kyiv Polytechnic Institute", "domain": "kpi.ua", "country": "UA", "weight": 75},
    
    # ============================================
    # UNITED ARAB EMIRATES
    # ============================================
    {"id": 0, "idExtended": "AE-UAEU", "name": "United Arab Emirates University", "domain": "uaeu.ac.ae", "country": "AE", "weight": 78},
    {"id": 0, "idExtended": "AE-KU", "name": "Khalifa University", "domain": "ku.ac.ae", "country": "AE", "weight": 78},
    {"id": 0, "idExtended": "AE-AUS", "name": "American University of Sharjah", "domain": "aus.edu", "country": "AE", "weight": 75},
    
    # ============================================
    # VENEZUELA
    # ============================================
    {"id": 0, "idExtended": "VE-UCV", "name": "Universidad Central de Venezuela", "domain": "ucv.ve", "country": "VE", "weight": 70},
    {"id": 0, "idExtended": "VE-USB", "name": "Universidad Simón Bolívar", "domain": "usb.ve", "country": "VE", "weight": 70},
    
    # ============================================
    # VIETNAM
    # ============================================
    {"id": 0, "idExtended": "VN-VNU", "name": "Vietnam National University, Hanoi", "domain": "vnu.edu.vn", "country": "VN", "weight": 75},
    {"id": 0, "idExtended": "VN-HCMUT", "name": "Ho Chi Minh City University of Technology", "domain": "hcmut.edu.vn", "country": "VN", "weight": 72},
    
    # ============================================
    # ZIMBABWE
    # ============================================
    {"id": 0, "idExtended": "ZW-UZ", "name": "University of Zimbabwe", "domain": "uz.ac.zw", "country": "ZW", "weight": 65},
]

# International first names by region
FIRST_NAMES_BY_REGION = {
    "US": ["James", "Michael", "David", "John", "Robert", "William", "Emily", "Sarah", "Jessica", "Ashley", "Amanda", "Jennifer"],
    "ES": ["Carlos", "Miguel", "José", "Juan", "María", "Ana", "Carmen", "Laura", "Sofía", "Isabella"],
    "FR": ["Jean", "Pierre", "Louis", "Marie", "Sophie", "Camille", "Emma", "Léa", "Chloé", "Lucas"],
    "DE": ["Hans", "Michael", "Thomas", "Anna", "Maria", "Sandra", "Julia", "Lisa", "Sophia", "Maximilian"],
    "IT": ["Marco", "Giuseppe", "Francesco", "Maria", "Giulia", "Francesca", "Sara", "Alessia", "Chiara", "Alessandro"],
    "PT": ["João", "Pedro", "Manuel", "Maria", "Ana", "Mariana", "Beatriz", "Inês", "Miguel", "Tiago"],
    "AR": ["Matías", "Santiago", "Nicolás", "Valentina", "Martina", "Camila", "Lucía", "Sofía", "Juan", "Diego"],
    "BD": ["Mohammad", "Abdul", "Rahim", "Fatima", "Aisha", "Nadia", "Ahmed", "Hassan", "Karim", "Zainab"],
    "PK": ["Ali", "Hassan", "Ahmed", "Fatima", "Ayesha", "Zara", "Omar", "Usman", "Bilal", "Sana"],
    "NG": ["Chukwuemeka", "Oluwaseun", "Adebayo", "Chioma", "Ngozi", "Amaka", "Tunde", "Emeka", "Yinka", "Funke"],
    "PH": ["Juan", "Jose", "Maria", "Ana", "Carlo", "Miguel", "Angela", "Patricia", "Mark", "John"],
    "VN": ["Nguyen", "Tran", "Minh", "Anh", "Linh", "Hoa", "Duc", "Tuan", "Huy", "Mai"],
    "TH": ["Somchai", "Somporn", "Pracha", "Supaporn", "Siriwan", "Naree", "Kittisak", "Pichit", "Niran", "Pranee"],
    "DEFAULT": ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Cameron", "Avery", "Quinn"]
}

LAST_NAMES_BY_REGION = {
    "US": ["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Taylor"],
    "ES": ["García", "Rodríguez", "Martínez", "López", "González", "Hernández", "Pérez", "Sánchez", "Ramírez", "Torres"],
    "FR": ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau"],
    "DE": ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann"],
    "IT": ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco"],
    "PT": ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Fernandes"],
    "AR": ["González", "Rodríguez", "Gómez", "Fernández", "López", "Díaz", "Martínez", "Pérez", "García", "Sánchez"],
    "BD": ["Rahman", "Hossain", "Khan", "Ahmed", "Islam", "Chowdhury", "Begum", "Akter", "Uddin", "Miah"],
    "PK": ["Khan", "Ahmed", "Ali", "Hussain", "Shah", "Malik", "Butt", "Iqbal", "Syed", "Mirza"],
    "NG": ["Okonkwo", "Adeyemi", "Okafor", "Eze", "Okwu", "Nwosu", "Ibe", "Chukwu", "Nnamdi", "Abubakar"],
    "PH": ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Villanueva", "Ramos"],
    "VN": ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Vo", "Dang", "Bui", "Do"],
    "TH": ["Saetang", "Srisawang", "Wongsawat", "Prakobkit", "Thongchai", "Charoenpol", "Somboon", "Rattana", "Pongpun", "Sanit"],
    "DEFAULT": ["Lee", "Kim", "Chen", "Wang", "Wong", "Singh", "Kumar", "Patel", "Zhang", "Liu"]
}

# Combined first and last names for backward compatibility
FIRST_NAMES = FIRST_NAMES_BY_REGION["US"] + FIRST_NAMES_BY_REGION["DEFAULT"]
LAST_NAMES = LAST_NAMES_BY_REGION["US"] + LAST_NAMES_BY_REGION["DEFAULT"]

# Country code to region mapping for name generation
COUNTRY_TO_REGION = {
    "US": "US", "CA": "US",  # North America - English names
    "AR": "AR", "CL": "AR", "VE": "AR", "PE": "AR", "EC": "AR", "BO": "AR", "GT": "ES", "SV": "ES", "NI": "ES", "DO": "ES",  # Latin America - Spanish
    "ES": "ES",  # Spain
    "FR": "FR", "BE": "FR", "CH": "FR",  # French-speaking
    "DE": "DE", "AT": "DE",  # German-speaking
    "IT": "IT",  # Italy
    "PT": "PT",  # Portugal
    "BD": "BD",  # Bangladesh
    "PK": "PK",  # Pakistan
    "NG": "NG", "GH": "NG", "KE": "NG", "ZA": "NG", "RW": "NG", "ZW": "NG",  # Africa
    "PH": "PH",  # Philippines
    "VN": "VN",  # Vietnam
    "TH": "TH",  # Thailand
    "MY": "DEFAULT", "SG": "DEFAULT", "TW": "DEFAULT",  # Southeast/East Asia
    "AU": "US", "NZ": "US", "GB": "US", "IE": "US",  # English-speaking
    "NL": "DEFAULT", "DK": "DEFAULT", "SE": "DEFAULT", "FI": "DEFAULT", "NO": "DEFAULT",  # Nordic/Dutch
    "PL": "DEFAULT", "CZ": "DEFAULT", "HU": "DEFAULT", "RO": "DEFAULT", "BG": "DEFAULT", "UA": "DEFAULT",  # Eastern Europe
    "TR": "DEFAULT", "GR": "DEFAULT",  # Mediterranean
    "IL": "DEFAULT", "JO": "DEFAULT", "IQ": "DEFAULT", "AE": "DEFAULT", "MA": "DEFAULT",  # Middle East/North Africa
    "LK": "DEFAULT",  # Sri Lanka
}


def select_university() -> dict:
    """Select US university with weighted random (higher weight = more likely)"""
    weights = [u.get("weight", 50) for u in UNIVERSITIES]
    total = sum(weights)
    r = random.uniform(0, total)
    cumulative = 0
    for u in UNIVERSITIES:
        cumulative += u.get("weight", 50)
        if r <= cumulative:
            return u
    return random.choice(UNIVERSITIES)


def lookup_organization_id(name: str, country: str = "US") -> Optional[dict]:
    """
    Dynamically lookup correct organization ID from SheerID API
    
    This queries the Gemini program's organization list to get the correct ID
    that works with this specific program.
    
    Args:
        name: University name to search for
        country: Country code (default US)
    
    Returns:
        dict with id, idExtended, name if found, None otherwise
    """
    import httpx
    
    try:
        # Query SheerID API for this program's organizations
        url = f"https://services.sheerid.com/rest/v2/program/{PROGRAM_ID}/organization"
        params = {
            "country": country,
            "segment": "student",
            "name": name.split(" (")[0]  # Remove location suffix if present
        }
        
        with httpx.Client(timeout=15) as client:
            response = client.get(url, params=params)
        
        if response.status_code != 200:
            print(f"[Lookup] API error: {response.status_code}")
            return None
        
        data = response.json()
        
        if not data:
            print(f"[Lookup] No results for: {name}")
            return None
        
        # Keywords to SKIP (sub-schools, extensions, medical/law schools)
        skip_keywords = [
            "medical", "medicine", "law school", "business school", 
            "extension", "online", "professional", "graduate school",
            "nursing", "dental", "pharmacy", "health science",
            "continuing education", "distance", "global"
        ]
        
        # Keywords to PREFER (main campus)
        prefer_keywords = [
            "main campus", "-main", "campus (", "university ("
        ]
        
        search_name = name.lower().split(" (")[0]  # Remove location suffix
        
        best_match = None
        fallback_match = None
        
        for org in data:
            org_name = org.get("name", "").lower()
            
            # Skip if contains skip keywords
            if any(skip in org_name for skip in skip_keywords):
                continue
            
            # Check if search name matches
            name_matches = search_name in org_name or org_name.startswith(search_name)
            
            if name_matches:
                # Prefer main campus entries
                if any(pref in org_name for pref in prefer_keywords):
                    best_match = org
                    break
                elif fallback_match is None:
                    fallback_match = org
        
        # Use best_match, or fallback, or first non-skipped result
        selected = best_match or fallback_match
        
        if not selected:
            # Find first result that doesn't have skip keywords
            for org in data:
                org_name = org.get("name", "").lower()
                if not any(skip in org_name for skip in skip_keywords):
                    selected = org
                    break
        
        if not selected and data:
            # Last resort: use first result
            selected = data[0]
        
        if selected:
            print(f"[Lookup] Found: {selected['id']} - {selected['name'][:50]}")
            return {
                "id": selected["id"],
                "idExtended": str(selected["id"]),
                "name": selected["name"]
            }
        
    except Exception as e:
        print(f"[Lookup] Error: {e}")
        return None


def select_university_with_lookup() -> dict:
    """
    Select university and verify/update ID from SheerID API
    
    This combines random selection with dynamic ID lookup to ensure
    we always have the correct organization ID for the Gemini program.
    """
    # First, select a university from our list
    university = select_university()
    
    # Try to lookup the correct ID from SheerID API
    lookup_result = lookup_organization_id(university["name"], university.get("country", "US"))
    
    if lookup_result:
        # Update ID with API result
        university["id"] = lookup_result["id"]
        university["idExtended"] = lookup_result["idExtended"]
        university["name"] = lookup_result["name"]
        print(f"[University] Using API ID: {university['id']} for {university['name'][:40]}")
    else:
        print(f"[University] Using cached ID: {university['id']} for {university['name'][:40]}")
    
    return university


def generate_name(country: str = "US") -> Tuple[str, str]:
    """Generate random first and last name based on country/region"""
    region = COUNTRY_TO_REGION.get(country, "DEFAULT")
    first_names = FIRST_NAMES_BY_REGION.get(region, FIRST_NAMES_BY_REGION["DEFAULT"])
    last_names = LAST_NAMES_BY_REGION.get(region, LAST_NAMES_BY_REGION["DEFAULT"])
    return random.choice(first_names), random.choice(last_names)


def generate_email(first: str, last: str, domain: str) -> str:
    """Generate realistic student email"""
    patterns = [
        f"{first.lower()}.{last.lower()}@{domain}",
        f"{first.lower()}{last.lower()[0]}@{domain}",
        f"{first.lower()[0]}{last.lower()}@{domain}",
        f"{first.lower()}{random.randint(1, 99)}@{domain}",
    ]
    return random.choice(patterns)


def generate_birth_date() -> str:
    """Generate valid student birth date (18-26 years old)"""
    year = random.randint(2000, 2006)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year}-{month:02d}-{day:02d}"


class SheerIDVerifier:
    """SheerID Verification with curl_cffi anti-detection"""
    
    def __init__(self, verification_id: str, proxy: str = None, on_progress: Callable = None):
        self.vid = verification_id
        self.fingerprint = get_fingerprint()
        self.on_progress = on_progress or (lambda x: None)
        
        # Create session with TLS fingerprint spoofing
        self.session, self.lib_name, self.impersonate = create_session(proxy)
        self.headers = get_headers()
        
        self.org = None
        self.student_info = None
    
    def __del__(self):
        if hasattr(self, 'session'):
            try:
                self.session.close()
            except:
                pass
    
    def _request(self, method: str, endpoint: str, body: dict = None) -> Tuple[dict, int]:
        """Make request with anti-detection headers"""
        random_delay(300, 800)
        
        url = f"{SHEERID_API_URL}{endpoint}"
        
        # Get proxy URL from session if available
        proxy_url = getattr(self.session, '_proxy_url', None)
        
        try:
            # curl_cffi requires proxy as parameter to each request for authentication to work
            kwargs = {"headers": self.headers, "timeout": 30}
            if proxy_url:
                kwargs["proxy"] = proxy_url
            
            if method.upper() == "GET":
                resp = self.session.get(url, **kwargs)
            elif method.upper() == "POST":
                resp = self.session.post(url, json=body, **kwargs)
            elif method.upper() == "DELETE":
                resp = self.session.delete(url, **kwargs)
            elif method.upper() == "PUT":
                resp = self.session.put(url, json=body, **kwargs)
            else:
                raise ValueError(f"Unknown method: {method}")
            
            try:
                data = resp.json() if resp.text else {}
            except:
                data = {"_text": resp.text}
            
            return data, resp.status_code
            
        except Exception as e:
            raise Exception(f"Request failed: {e}")
    
    def _upload_s3(self, url: str, data: bytes) -> bool:
        """Upload document to S3"""
        try:
            # Get proxy URL from session if available
            proxy_url = getattr(self.session, '_proxy_url', None)
            kwargs = {"data": data, "headers": {"Content-Type": "image/png"}, "timeout": 60}
            if proxy_url:
                kwargs["proxy"] = proxy_url
            
            resp = self.session.put(url, **kwargs)
            return 200 <= resp.status_code < 300
        except Exception as e:
            print(f"[S3 Upload] Error: {e}")
            return False
    
    def check_link(self) -> dict:
        """Check if verification link is valid"""
        if not self.vid:
            return {"valid": False, "error": "Invalid verification ID"}
        
        data, status = self._request("GET", f"/verification/{self.vid}")
        
        if status != 200:
            return {"valid": False, "error": f"HTTP {status}"}
        
        step = data.get("currentStep", "")
        valid_steps = ["collectStudentPersonalInfo", "docUpload", "sso"]
        
        if step in valid_steps:
            return {"valid": True, "step": step}
        elif step == "success":
            return {"valid": False, "error": "Already verified"}
        elif step == "pending":
            return {"valid": False, "error": "Pending review"}
        
        return {"valid": False, "error": f"Invalid step: {step}"}
    
    def verify(self, doc_data: bytes) -> dict:
        """Run full verification"""
        if not self.vid:
            return {"success": False, "error": "Invalid verification ID"}
        
        try:
            # Warm up session first
            self.on_progress({"step": "warming", "message": "Warming up session..."})
            warm_session(self.session, headers=self.headers)
            
            # Check current step
            self.on_progress({"step": "checking", "message": "Checking verification status..."})
            check_data, check_status = self._request("GET", f"/verification/{self.vid}")
            current_step = check_data.get("currentStep", "") if check_status == 200 else ""
            
            if current_step == "success":
                return {"success": True, "status": "success", "message": "Already verified"}
            if current_step == "pending":
                return {"success": True, "status": "pending", "message": "Already pending review"}
            
            # Use pre-generated student info if available (from main.py)
            # This ensures document and form have matching data!
            if hasattr(self, 'pre_generated') and self.pre_generated and hasattr(self, 'student_info'):
                first = self.student_info["firstName"]
                last = self.student_info["lastName"]
                email = self.student_info["email"]
                dob = self.student_info["birthDate"]
                print(f"[Verify] Using pre-generated info: {first} {last}")
            else:
                # Generate new student info (fallback)
                self.org = select_university()
                first, last = generate_name(self.org.get("country", "US"))
                email = generate_email(first, last, self.org["domain"])
                dob = generate_birth_date()
                
                self.student_info = {
                    "firstName": first,
                    "lastName": last,
                    "email": email,
                    "birthDate": dob
                }
            
            self.on_progress({
                "step": "info_generated",
                "message": f"Student: {first} {last}",
                "details": {
                    "name": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"],
                    "birthDate": dob
                }
            })
            
            # Step 1: Submit student info (if needed)
            if current_step == "collectStudentPersonalInfo":
                self.on_progress({"step": "submitting", "message": "Submitting student info..."})
                
                body = {
                    "firstName": first,
                    "lastName": last,
                    "birthDate": dob,
                    "email": email,
                    "phoneNumber": "",
                    "country": self.org.get("country", "US"),  # Add country field
                    "organization": {
                        "id": self.org["id"],
                        "idExtended": self.org["idExtended"],
                        "name": self.org["name"]
                    },
                    "deviceFingerprintHash": self.fingerprint,
                    "locale": "en-US",
                    "metadata": {
                        "marketConsentValue": False,
                        "verificationId": self.vid,
                        "refererUrl": f"https://services.sheerid.com/verify/{PROGRAM_ID}/?verificationId={self.vid}",
                        "flags": '{"collect-info-step-email-first":"default","doc-upload-considerations":"default","doc-upload-may24":"default","doc-upload-redesign-use-legacy-message-keys":false,"docUpload-assertion-checklist":"default","font-size":"default","include-cvec-field-france-student":"not-labeled-optional"}',
                        "submissionOptIn": "By submitting the personal information above, I acknowledge that my personal information is being collected under the privacy policy of the business from which I am seeking a discount"
                    }
                }
                
                # Debug: Log country field
                print(f"[Verify] Submitting with country: {body.get('country')}, org: {self.org.get('name')}")
                
                data, status = self._request("POST", f"/verification/{self.vid}/step/collectStudentPersonalInfo", body)
                
                if status != 200:
                    # Log detailed error for debugging
                    print(f"[Verify] Submit failed with status {status}")
                    print(f"[Verify] Response data: {data}")
                    error_msg = data.get("message", "") if isinstance(data, dict) else str(data)
                    error_ids = data.get("errorIds", []) if isinstance(data, dict) else []
                    return {"success": False, "error": f"Submit failed: {status}", "details": error_msg, "errorIds": error_ids}
                
                if data.get("currentStep") == "error":
                    error_ids = data.get("errorIds", [])
                    print(f"[Verify] SheerID error: {error_ids}")
                    return {"success": False, "error": f"Error: {error_ids}"}
                
                current_step = data.get("currentStep", "")
                self.on_progress({"step": "submitted", "message": f"Current step: {current_step}"})
            
            # Step 2: Skip SSO if needed (ThanhNguyxn's PastKing logic)
            # Must skip SSO at both 'sso' AND 'collectStudentPersonalInfo' steps
            if current_step in ["sso", "collectStudentPersonalInfo"]:
                self.on_progress({"step": "skipping_sso", "message": "Skipping SSO..."})
                self._request("DELETE", f"/verification/{self.vid}/step/sso")
            
            # Step 3: Request upload URL (ThanhNguyxn's approach)
            self.on_progress({"step": "uploading", "message": "Requesting upload URL..."})
            
            # Use docUpload endpoint like ThanhNguyxn
            upload_body = {"files": [{"fileName": "transcript.png", "mimeType": "image/png", "fileSize": len(doc_data)}]}
            upload_data, upload_status = self._request(
                "POST", 
                f"/verification/{self.vid}/step/docUpload",
                upload_body
            )
            
            if upload_status != 200:
                print(f"[Verify] Upload request failed: {upload_status}")
                print(f"[Verify] Upload response: {upload_data}")
                return {"success": False, "error": f"Upload URL request failed: {upload_status}"}
            
            # Get upload URL from documents array
            documents = upload_data.get("documents", [])
            if not documents:
                return {"success": False, "error": "No documents in upload response"}
            
            upload_url = documents[0].get("uploadUrl")
            
            if not upload_url:
                return {"success": False, "error": "No upload URL in response"}
            
            # Step 4: Upload document to S3
            self.on_progress({"step": "uploading", "message": "Uploading document..."})
            
            if not self._upload_s3(upload_url, doc_data):
                return {"success": False, "error": "S3 upload failed"}
            
            print("[Verify] ✅ Document uploaded to S3")
            
            # Step 5: Complete document upload (ThanhNguyxn's approach)
            self.on_progress({"step": "completing", "message": "Completing upload..."})
            
            complete_data, complete_status = self._request(
                "POST",
                f"/verification/{self.vid}/step/completeDocUpload"
            )
            
            print(f"[Verify] Complete upload response: {complete_data.get('currentStep', 'unknown')}")
            
            final_step = complete_data.get("currentStep", "")
            
            if final_step == "pending":
                return {
                    "success": True,
                    "status": "pending",
                    "message": "Submitted for review",
                    "student": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"]
                }
            elif final_step == "success":
                return {
                    "success": True,
                    "status": "success",
                    "message": "Verified!",
                    "student": f"{first} {last}",
                    "email": email,
                    "school": self.org["name"]
                }
            elif final_step == "error":
                error_ids = complete_data.get("errorIds", [])
                return {"success": False, "error": f"Verification error: {error_ids}"}
            else:
                return {"success": False, "error": f"Unexpected step: {final_step}", "data": complete_data}
            
        except Exception as e:
            return {"success": False, "error": str(e)}


def parse_verification_id(url_or_id: str) -> Optional[str]:
    """Extract verification ID from URL or return as-is if already ID"""
    if not url_or_id:
        return None
    
    # Already just an ID (hex string)
    if re.match(r'^[a-f0-9]{24}$', url_or_id.lower()):
        return url_or_id.lower()
    
    # Extract from URL
    match = re.search(r'verificationId=([a-f0-9]+)', url_or_id, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    
    # Try extracting from path
    match = re.search(r'/([a-f0-9]{24})(?:\?|$|/)', url_or_id, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    
    return None


def poll_verification_status(vid: str, max_attempts: int = 30, interval: int = 10, proxy: str = None) -> dict:
    """
    Poll SheerID API to monitor verification status until final result
    
    Args:
        vid: Verification ID
        max_attempts: Maximum number of polling attempts (default 30 = 5 minutes with 10s interval)
        interval: Seconds between polls (default 10)
        proxy: Optional proxy URL
    
    Returns:
        dict with final status
    """
    import time
    import httpx
    
    print(f"[Monitor] Starting to poll verification {vid}")
    print(f"[Monitor] Max attempts: {max_attempts}, Interval: {interval}s")
    
    for attempt in range(1, max_attempts + 1):
        try:
            # Build request
            url = f"https://services.sheerid.com/rest/v2/verification/{vid}"
            
            # Use proxy if specified
            client_kwargs = {"timeout": 30}
            if proxy:
                client_kwargs["proxy"] = proxy
            
            with httpx.Client(**client_kwargs) as client:
                response = client.get(url)
                
            if response.status_code != 200:
                print(f"[Monitor] Attempt {attempt}: HTTP {response.status_code}")
                time.sleep(interval)
                continue
            
            data = response.json()
            current_step = data.get("currentStep", "")
            error_ids = data.get("errorIds", [])
            rejection_reasons = data.get("rejectionReasons", [])
            
            print(f"[Monitor] Attempt {attempt}/{max_attempts}: step={current_step}, errors={error_ids}")
            
            # Final states
            if current_step == "success":
                return {
                    "success": True,
                    "status": "success",
                    "message": "Verification approved!",
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            if current_step == "error":
                return {
                    "success": False,
                    "status": "error",
                    "message": f"Verification failed: {error_ids}",
                    "errorIds": error_ids,
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            # Check for rejection reasons (docUpload with rejection means re-upload needed)
            if current_step == "docUpload" and rejection_reasons:
                return {
                    "success": False,
                    "status": "rejected",
                    "message": f"Document rejected: {rejection_reasons}",
                    "rejectionReasons": rejection_reasons,
                    "verificationId": vid,
                    "attempts": attempt
                }
            
            # Still pending - continue polling
            if current_step == "pending":
                print(f"[Monitor] Status: pending, waiting {interval}s...")
                time.sleep(interval)
                continue
            
            # Other states (collectStudentPersonalInfo, docUpload without rejection)
            print(f"[Monitor] Status: {current_step}, waiting {interval}s...")
            time.sleep(interval)
            
        except Exception as e:
            print(f"[Monitor] Attempt {attempt} error: {e}")
            time.sleep(interval)
    
    # Timeout
    return {
        "success": False,
        "status": "timeout",
        "message": f"Polling timed out after {max_attempts} attempts",
        "verificationId": vid,
        "attempts": max_attempts
    }
