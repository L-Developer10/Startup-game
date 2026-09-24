import random
import string
import time
import threading
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'startup-wars-secret-key-2026'
# Permitir CORS e modo de execução flexível
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# -------------------------------------------------------------
# ESTRUTURA DE DADOS E CONSTANTES
# -------------------------------------------------------------

# Armazenamento em memória das salas
# Código_da_Sala -> Dict com dados da sala
rooms = {}

# Mapeamento de SID -> Código_da_Sala
sid_to_room = {}

# Custos e Salários de Funcionários
EMPLOYEE_CONFIG = {
    'worker': {'name': 'Operário', 'hire_cost': 400, 'salary': 120, 'desc': 'Produz 2 produtos/ciclo a partir de insumos'},
    'sales': {'name': 'Vendedor', 'hire_cost': 500, 'salary': 150, 'desc': 'Aumenta capacidade de vendas em +3 un/ciclo'},
    'marketing': {'name': 'Marketer', 'hire_cost': 600, 'salary': 180, 'desc': 'Melhora reputação e atrai mais clientes'},
    'dev': {'name': 'Desenvolvedor', 'hire_cost': 800, 'salary': 220, 'desc': 'Aumenta valor percebido e eficiência geral'}
}

# Níveis da Empresa e Armazém
COMPANY_UPGRADES = {
    1: {'name': 'Garagem', 'cost': 0, 'capacity': 100},
    2: {'name': 'Escritório Compartilhado', 'cost': 3000, 'capacity': 250},
    3: {'name': 'Sede Própria', 'cost': 7500, 'capacity': 600},
    4: {'name': 'Centro de Distribuição', 'cost': 16000, 'capacity': 1400},
    5: {'name': 'Multinacional Tech', 'cost': 35000, 'capacity': 3000}
}

# Campanhas de Marketing
MARKETING_CAMPAIGNS = {
    'social': {'name': 'Redes Sociais', 'cost': 500, 'rep_boost': 6, 'demand_boost': 1.25, 'duration': 40},
    'influencer': {'name': 'Influenciadores', 'cost': 1500, 'rep_boost': 14, 'demand_boost': 1.60, 'duration': 45},
    'tv': {'name': 'Comercial de TV', 'cost': 4000, 'rep_boost': 28, 'demand_boost': 2.10, 'duration': 50},
    'global': {'name': 'Patrocínio Global', 'cost': 10000, 'rep_boost': 50, 'demand_boost': 3.00, 'duration': 60}
}

# Multiplicadores da Roleta BET
BET_MULTIPLIERS = [
    {'val': 0.0, 'weight': 32, 'label': '0x (Perdeu)'},
    {'val': 0.5, 'weight': 25, 'label': '0.5x (Metade)'},
    {'val': 1.0, 'weight': 18, 'label': '1x (Recuperou)'},
    {'val': 1.5, 'weight': 12, 'label': '1.5x (+50%)'},
    {'val': 2.0, 'weight': 9, 'label': '2x (Dobrou!)'},
    {'val': 5.0, 'weight': 4, 'label': '5x (JACKPOT!)'}
]

# Eventos Globais de Mercado
GLOBAL_EVENTS = [
    {
        'id': 'high_demand',
        'title': '📈 Alta Demanda no Mercado!',
        'description': 'Os consumidores estão comprando loucamente! Vendas aumentadas em +60%.',
        'sales_mult': 1.6,
        'supply_mult': 1.0,
        'duration': 25
    },
    {
        'id': 'sales_drop',
        'title': '📉 Crise de Consumo!',
        'description': 'O mercado está cauteloso. A procura por produtos caiu 40%.',
        'sales_mult': 0.6,
        'supply_mult': 1.0,
        'duration': 25
    },
    {
        'id': 'viral_product',
        'title': '🔥 Tendência Viral na Internet!',
        'description': 'Produtos similares viralizaram no TikTok! Vendas dobradas (+100%).',
        'sales_mult': 2.0,
        'supply_mult': 1.0,
        'duration': 20
    },
    {
        'id': 'supplier_crisis',
        'title': '🚚 Crise nos Fornecedores!',
        'description': 'Falta de frete encareceu os insumos de matéria-prima em +75%.',
        'sales_mult': 1.0,
        'supply_mult': 1.75,
        'duration': 25
    },
    {
        'id': 'supply_discount',
        'title': '🏷️ Liquidação de Matéria-Prima!',
        'description': 'Fornecedores com excesso de estoque vendem insumos com 45% de desconto.',
        'sales_mult': 1.0,
        'supply_mult': 0.55,
        'duration': 25
    },
    {
        'id': 'economic_boom',
        'title': '💰 Boom Econômico Geral!',
        'description': 'Economia aquecida! +30% de vendas e insumos mais acessíveis.',
        'sales_mult': 1.3,
        'supply_mult': 0.85,
        'duration': 30
    }
]

# -------------------------------------------------------------
# FUNÇÕES AUXILIARES
# -------------------------------------------------------------

def generate_room_code():
    """Gera um código único de 5 caracteres alfanuméricos."""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))
        # Evitar códigos confusos ou já existentes
        if code not in rooms and 'O' not in code and '0' not in code and 'I' not in code and '1' not in code:
            return code

def calculate_player_net_worth(player, raw_price):
    """Calcula o patrimônio líquido total do jogador."""
    cash = player['money']
    products_value = player['finished_products'] * player['product_price'] * 0.8
    raw_materials_value = player['raw_materials'] * raw_price
    company_value = COMPANY_UPGRADES[player['company_level']]['cost'] or 1500
    employees_val = sum(player['employees'].values()) * 500
    rep_val = player['reputation'] * 30
    return round(cash + products_value + raw_materials_value + company_value + employees_val + rep_val, 2)

def calculate_ranking(room):
    """Calcula o ranking ordenado de todos os jogadores da sala."""
    ranked = []
    raw_price = room['market']['raw_material_price']
    
    for sid, player in room['players'].items():
        net_worth = calculate_player_net_worth(player, raw_price)
        player['net_worth'] = net_worth
        ranked.append({
            'sid': sid,
            'name': player['name'],
            'company_name': player['company_name'],
            'net_worth': net_worth,
            'money': player['money'],
            'revenue': player['total_revenue'],
            'profit': player['total_profit'],
            'products_sold': player['total_products_sold'],
            'is_host': player.get('is_host', False)
        })
    
    # Ordenar por patrimônio líquido decrescente
    ranked.sort(key=lambda x: x['net_worth'], reverse=True)
    return ranked

def get_public_rooms_list():
    """Retorna a lista de salas públicas disponíveis para o lobby."""
    public_list = []
    for code, room in rooms.items():
        if room['state'] == 'WAITING':
            public_list.append({
                'code': code,
                'players_count': len(room['players']),
                'max_players': 5,
                'mode': '⚡ 5 min' if room['mode'] == 'fast' else '🕐 10 min',
                'raw_mode': room['mode'],
                'host_name': room['players'].get(room['host_sid'], {}).get('name', 'Anfitrião')
            })
    return public_list

# -------------------------------------------------------------
# GAME LOOP (EXECUTADO EM THREAD POR SALA ATIVA)
# -------------------------------------------------------------

def run_game_loop(room_code):
    """Loop de economia e tempo de partida para uma sala ativa."""
    tick_count = 0
    
    while True:
        time.sleep(2.0) # Tick de 2 segundos
        
        if room_code not in rooms:
            break
            
        room = rooms[room_code]
        
        if room['state'] != 'IN_GAME':
            break
            
        room['time_remaining'] -= 2
        tick_count += 1
        
        # 1. Atualização do Mercado (Preço de Insumo e Eventos)
        market = room['market']
        
        # Flutuação suave da cotação base a cada 5 ticks (10s)
        if tick_count % 5 == 0:
            market['base_raw_price'] = max(25, min(80, market['base_raw_price'] + random.randint(-6, 6)))
        
        # Verificar término de evento ativo
        if market['active_event']:
            market['event_timer'] -= 2
            if market['event_timer'] <= 0:
                market['active_event'] = None
                market['sales_multiplier'] = 1.0
                market['supply_multiplier'] = 1.0
                socketio.emit('event_ended', {'message': 'O mercado voltou à normalidade.'}, room=room_code)
        
        # Disparo de novo evento global aleatório a cada ~36s (18 ticks)
        if not market['active_event'] and tick_count % 18 == 0:
            ev = random.choice(GLOBAL_EVENTS)
            market['active_event'] = ev
            market['sales_multiplier'] = ev['sales_mult']
            market['supply_multiplier'] = ev['supply_mult']
            market['event_timer'] = ev['duration']
            
            socketio.emit('global_event_started', {
                'event': ev,
                'message': f"📢 {ev['title']}: {ev['description']}"
            }, room=room_code)
            
        # Calcular preço final atual dos insumos
        market['raw_material_price'] = round(market['base_raw_price'] * market['supply_multiplier'], 2)
        
        # 2. Processamento da Economia de Cada Jogador
        is_payroll_tick = (tick_count % 5 == 0) # Folha de pagamento a cada 10 segundos
        
        for sid, player in list(room['players'].items()):
            # Atualizar campanhas de marketing ativas
            if player['active_campaign']:
                player['campaign_timer'] -= 2
                if player['campaign_timer'] <= 0:
                    player['active_campaign'] = None
                    player['campaign_demand_mult'] = 1.0
            
            # --- A. Produção por Operários ---
            workers = player['employees']['worker']
            if workers > 0 and player['raw_materials'] > 0:
                cap = COMPANY_UPGRADES[player['company_level']]['capacity']
                current_total_stock = player['raw_materials'] + player['finished_products']
                
                # Capacidade de conversão: 2 unidades por operário por tick
                can_convert = min(player['raw_materials'], workers * 2)
                # Respeitar limite de armazenamento do armazém
                can_convert = min(can_convert, max(0, cap - player['finished_products']))
                
                if can_convert > 0:
                    player['raw_materials'] -= can_convert
                    player['finished_products'] += can_convert
            
            # --- B. Vendas de Produtos Acabados ---
            if player['finished_products'] > 0:
                # Fatores de demanda: Preço (base 100), Reputação (0-100), Vendedores, Marketing e Eventos
                price = player['product_price']
                # Elasticidade de preço
                price_factor = max(0.2, min(2.5, 100.0 / max(30, price)))
                rep_factor = 0.5 + (player['reputation'] / 100.0)
                sales_staff_bonus = 1.0 + (player['employees']['sales'] * 0.45)
                dev_quality_bonus = 1.0 + (player['employees']['dev'] * 0.25)
                marketing_staff_bonus = 1.0 + (player['employees']['marketing'] * 0.35)
                
                # Demanda calculada por tick
                base_units = random.uniform(1.0, 3.5)
                demand_units = int(base_units * price_factor * rep_factor * sales_staff_bonus * 
                                  dev_quality_bonus * marketing_staff_bonus * 
                                  player['campaign_demand_mult'] * market['sales_multiplier'])
                
                # Vender até o estoque disponível
                units_sold = min(player['finished_products'], demand_units)
                
                if units_sold > 0:
                    revenue = units_sold * price
                    player['finished_products'] -= units_sold
                    player['money'] = round(player['money'] + revenue, 2)
                    player['total_revenue'] = round(player['total_revenue'] + revenue, 2)
                    player['total_profit'] = round(player['total_profit'] + revenue, 2)
                    player['total_products_sold'] += units_sold
                    
                    # Pequeno ganho orgânico de reputação pelas vendas bem sucedidas
                    if random.random() < 0.25 and player['reputation'] < 100:
                        player['reputation'] = min(100, player['reputation'] + 1)
            
            # --- C. Pagamento de Salários ---
            if is_payroll_tick:
                total_salaries = sum(
                    player['employees'][role] * EMPLOYEE_CONFIG[role]['salary']
                    for role in player['employees']
                )
                if total_salaries > 0:
                    player['money'] = round(player['money'] - total_salaries, 2)
                    player['total_expenses'] = round(player['total_expenses'] + total_salaries, 2)
                    player['total_profit'] = round(player['total_profit'] - total_salaries, 2)
                    
                    # Se o dinheiro ficar muito negativo, reputação cai
                    if player['money'] < -1500:
                        player['reputation'] = max(10, player['reputation'] - 4)
        
        # 3. Recálculo do Ranking e Envio de Estado Sincronizado
        ranking = calculate_ranking(room)
        
        # Emitir tick para cada jogador com visão personalizada + dados globais
        for sid, player in room['players'].items():
            socketio.emit('game_tick', {
                'time_remaining': max(0, room['time_remaining']),
                'market': {
                    'raw_material_price': market['raw_material_price'],
                    'base_price': market['base_raw_price'],
                    'active_event': market['active_event'],
                    'event_timer': market['event_timer']
                },
                'player_data': {
                    'money': player['money'],
                    'net_worth': player['net_worth'],
                    'revenue': player['total_revenue'],
                    'expenses': player['total_expenses'],
                    'profit': player['total_profit'],
                    'raw_materials': player['raw_materials'],
                    'finished_products': player['finished_products'],
                    'product_price': player['product_price'],
                    'reputation': player['reputation'],
                    'company_level': player['company_level'],
                    'storage_capacity': COMPANY_UPGRADES[player['company_level']]['capacity'],
                    'employees': player['employees'],
                    'active_campaign': player['active_campaign'],
                    'campaign_timer': player['campaign_timer'],
                    'bet_stats': player['bet_stats'],
                    'total_products_sold': player['total_products_sold']
                },
                'ranking': ranking
            }, room=sid)
            
        # 4. Fim de Partida
        if room['time_remaining'] <= 0:
            room['state'] = 'FINISHED'
            
            # Determinar premiações especiais
            best_revenue = max(ranking, key=lambda x: x['revenue'])
            best_profit = max(ranking, key=lambda x: x['profit'])
            most_sold = max(ranking, key=lambda x: x['products_sold'])
            
            # Apuração do Rei da BET
            bet_leaders = []
            for sid, p in room['players'].items():
                net_bet = p['bet_stats']['won_amount'] - p['bet_stats']['lost_amount']
                bet_leaders.append({'name': p['name'], 'net_bet': net_bet, 'bets_count': p['bet_stats']['bets_count']})
            bet_leaders.sort(key=lambda x: x['net_bet'], reverse=True)
            bet_king = bet_leaders[0] if bet_leaders else None
            
            socketio.emit('game_over', {
                'ranking': ranking,
                'awards': {
                    'champion': ranking[0] if ranking else None,
                    'best_revenue': best_revenue,
                    'best_profit': best_profit,
                    'most_sold': most_sold,
                    'bet_king': bet_king
                }
            }, room=room_code)
            break

# -------------------------------------------------------------
# ROTAS HTTP
# -------------------------------------------------------------

@app.route('/')
def index():
    """Renderiza a aplicação de página única."""
    return render_template('index.html')

# -------------------------------------------------------------
# EVENTOS SOCKET.IO
# -------------------------------------------------------------

@socketio.on('get_public_rooms')
def handle_get_public_rooms():
    """Retorna lista de salas em espera para os clientes navegando no lobby."""
    emit('public_rooms_list', get_public_rooms_list())

@socketio.on('create_room')
def handle_create_room(data):
    """Cria uma nova sala de jogo."""
    player_name = (data.get('playerName') or 'Jogador').strip()[:20]
    company_name = (data.get('companyName') or 'Minha Startup').strip()[:25]
    mode = data.get('mode', 'fast') # 'fast' (5 min) ou 'normal' (10 min)
    
    room_code = generate_room_code()
    sid = request.sid
    
    # Duração em segundos
    duration = 300 if mode == 'fast' else 600
    
    # Inicialização da estrutura da sala
    rooms[room_code] = {
        'code': room_code,
        'host_sid': sid,
        'mode': mode,
        'duration': duration,
        'time_remaining': duration,
        'state': 'WAITING', # WAITING, IN_GAME, FINISHED
        'market': {
            'base_raw_price': 50.0,
            'raw_material_price': 50.0,
            'sales_multiplier': 1.0,
            'supply_multiplier': 1.0,
            'active_event': None,
            'event_timer': 0
        },
        'players': {}
    }
    
    # Adicionar o criador à sala
    rooms[room_code]['players'][sid] = {
        'sid': sid,
        'name': player_name,
        'company_name': company_name,
        'is_host': True,
        'money': 10000.0,
        'net_worth': 10000.0,
        'total_revenue': 0.0,
        'total_expenses': 0.0,
        'total_profit': 0.0,
        'total_products_sold': 0,
        'raw_materials': 25,
        'finished_products': 5,
        'product_price': 100.0,
        'reputation': 50,
        'company_level': 1,
        'employees': {
            'worker': 1,
            'sales': 1,
            'marketing': 0,
            'dev': 0
        },
        'active_campaign': None,
        'campaign_timer': 0,
        'campaign_demand_mult': 1.0,
        'bet_stats': {
            'bets_count': 0,
            'won_amount': 0.0,
            'lost_amount': 0.0
        }
    }
    
    join_room(room_code)
    sid_to_room[sid] = room_code
    
    emit('room_created', {
        'room_code': room_code,
        'player_sid': sid,
        'is_host': True,
        'room_data': {
            'code': room_code,
            'mode': mode,
            'state': 'WAITING',
            'players': list(rooms[room_code]['players'].values())
        }
    })
    
    # Atualizar lista pública de salas para quem estiver no lobby
    socketio.emit('public_rooms_list', get_public_rooms_list())

@socketio.on('join_room')
def handle_join_room(data):
    """Entra em uma sala existente através do código."""
    room_code = (data.get('roomCode') or '').strip().upper()
    player_name = (data.get('playerName') or 'Jogador').strip()[:20]
    company_name = (data.get('companyName') or 'Nova Startup').strip()[:25]
    sid = request.sid
    
    if room_code not in rooms:
        emit('join_error', {'message': 'Sala não encontrada. Verifique o código.'})
        return
        
    room = rooms[room_code]
    
    if room['state'] != 'WAITING':
        emit('join_error', {'message': 'A partida nesta sala já foi iniciada ou encerrada.'})
        return
        
    if len(room['players']) >= 5:
        emit('join_error', {'message': 'Sala cheia! Máximo de 5 jogadores.'})
        return
        
    # Adicionar o novo jogador
    room['players'][sid] = {
        'sid': sid,
        'name': player_name,
        'company_name': company_name,
        'is_host': False,
        'money': 10000.0,
        'net_worth': 10000.0,
        'total_revenue': 0.0,
        'total_expenses': 0.0,
        'total_profit': 0.0,
        'total_products_sold': 0,
        'raw_materials': 25,
        'finished_products': 5,
        'product_price': 100.0,
        'reputation': 50,
        'company_level': 1,
        'employees': {
            'worker': 1,
            'sales': 1,
            'marketing': 0,
            'dev': 0
        },
        'active_campaign': None,
        'campaign_timer': 0,
        'campaign_demand_mult': 1.0,
        'bet_stats': {
            'bets_count': 0,
            'won_amount': 0.0,
            'lost_amount': 0.0
        }
    }
    
    join_room(room_code)
    sid_to_room[sid] = room_code
    
    emit('room_joined', {
        'room_code': room_code,
        'player_sid': sid,
        'is_host': False,
        'room_data': {
            'code': room_code,
            'mode': room['mode'],
            'state': 'WAITING',
            'players': list(room['players'].values())
        }
    })
    
    # Notificar os outros jogadores da sala
    socketio.emit('player_joined', {
        'player': room['players'][sid],
        'players': list(room['players'].values()),
        'message': f"🟢 {player_name} ({company_name}) entrou na sala!"
    }, room=room_code)
    
    # Atualizar lista pública
    socketio.emit('public_rooms_list', get_public_rooms_list())

@socketio.on('start_game')
def handle_start_game(data):
    """O anfitrião inicia a partida."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    
    if not room_code or room_code not in rooms:
        return
        
    room = rooms[room_code]
    
    # Validações
    if room['host_sid'] != sid:
        emit('action_error', {'message': 'Apenas o criador da sala pode iniciar a partida.'})
        return
        
    if len(room['players']) < 2:
        emit('action_error', {'message': 'Mínimo de 2 jogadores para iniciar.'})
        return
        
    room['state'] = 'IN_GAME'
    
    # Disparar transição de tela para todos os jogadores da sala
    socketio.emit('game_started', {
        'room_code': room_code,
        'mode': room['mode'],
        'duration': room['duration'],
        'market': room['market'],
        'ranking': calculate_ranking(room)
    }, room=room_code)
    
    # Atualizar salas públicas (agora está ocupada)
    socketio.emit('public_rooms_list', get_public_rooms_list())
    
    # Iniciar o loop de partida em segundo plano
    threading.Thread(target=run_game_loop, args=(room_code,), daemon=True).start()

# -------------------------------------------------------------
# AÇÕES DO JOGADOR DURANTE A PARTIDA
# -------------------------------------------------------------

@socketio.on('buy_raw_materials')
def handle_buy_raw_materials(data):
    """Comprar insumos de matéria-prima."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    player = room['players'][sid]
    amount = int(data.get('amount', 10))
    raw_price = room['market']['raw_material_price']
    cap = COMPANY_UPGRADES[player['company_level']]['capacity']
    current_space = player['raw_materials'] + player['finished_products']
    
    if amount <= 0:
        return
        
    # Limitar pela capacidade do armazém
    max_can_store = max(0, cap - current_space)
    if amount > max_can_store:
        amount = max_can_store
        
    if amount <= 0:
        emit('action_feedback', {'success': False, 'message': 'Armazém cheio! Faça um upgrade de sede.'})
        return
        
    total_cost = round(amount * raw_price, 2)
    if player['money'] < total_cost:
        emit('action_feedback', {'success': False, 'message': 'Dinheiro insuficiente para comprar insumos.'})
        return
        
    player['money'] = round(player['money'] - total_cost, 2)
    player['total_expenses'] = round(player['total_expenses'] + total_cost, 2)
    player['total_profit'] = round(player['total_profit'] - total_cost, 2)
    player['raw_materials'] += amount
    
    emit('action_feedback', {
        'success': True,
        'message': f"Comprados +{amount} insumos por R$ {total_cost:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    })

@socketio.on('produce_manual')
def handle_produce_manual():
    """Produção manual de lote rápido."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    player = room['players'][sid]
    cap = COMPANY_UPGRADES[player['company_level']]['capacity']
    
    if player['raw_materials'] < 1:
        emit('action_feedback', {'success': False, 'message': 'Sem insumos! Compre matéria-prima no mercado.'})
        return
        
    if player['finished_products'] >= cap:
        emit('action_feedback', {'success': False, 'message': 'Armazém de produtos acabados cheio!'})
        return
        
    batch = min(player['raw_materials'], 5)
    batch = min(batch, cap - player['finished_products'])
    
    player['raw_materials'] -= batch
    player['finished_products'] += batch
    
    emit('action_feedback', {'success': True, 'message': f"Produção expressa: +{batch} produtos finalizados!"})

@socketio.on('set_product_price')
def handle_set_product_price(data):
    """Altera o preço de venda dos produtos da empresa."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    new_price = float(data.get('price', 100.0))
    new_price = max(20.0, min(500.0, new_price))
    
    player = room['players'][sid]
    player['product_price'] = round(new_price, 2)
    
    emit('action_feedback', {'success': True, 'message': f"Preço de venda ajustado para R$ {new_price:.2f}"})

@socketio.on('hire_employee')
def handle_hire_employee(data):
    """Contrata um novo funcionário."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    role = data.get('role')
    if role not in EMPLOYEE_CONFIG:
        return
        
    player = room['players'][sid]
    cost = EMPLOYEE_CONFIG[role]['hire_cost']
    
    if player['money'] < cost:
        emit('action_feedback', {'success': False, 'message': f"Dinheiro insuficiente para contratar {EMPLOYEE_CONFIG[role]['name']} (R$ {cost})."})
        return
        
    player['money'] = round(player['money'] - cost, 2)
    player['total_expenses'] = round(player['total_expenses'] + cost, 2)
    player['total_profit'] = round(player['total_profit'] - cost, 2)
    player['employees'][role] += 1
    
    # Bônus imediato de contratação
    if role == 'marketing':
        player['reputation'] = min(100, player['reputation'] + 3)
        
    emit('action_feedback', {'success': True, 'message': f"Contratado 1x {EMPLOYEE_CONFIG[role]['name']}!"})

@socketio.on('fire_employee')
def handle_fire_employee(data):
    """Demite um funcionário para cortar custos de folha salarial."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    role = data.get('role')
    if role not in EMPLOYEE_CONFIG:
        return
        
    player = room['players'][sid]
    if player['employees'][role] <= 0:
        emit('action_feedback', {'success': False, 'message': 'Nenhum funcionário desse cargo para demitir.'})
        return
        
    player['employees'][role] -= 1
    player['reputation'] = max(10, player['reputation'] - 2) # Pequena penalidade de clima
    
    emit('action_feedback', {'success': True, 'message': f"Demitido 1x {EMPLOYEE_CONFIG[role]['name']}. Salário mensal reduzido."})

@socketio.on('upgrade_company')
def handle_upgrade_company():
    """Melhora a sede e a capacidade do armazém da empresa."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    player = room['players'][sid]
    current_lvl = player['company_level']
    next_lvl = current_lvl + 1
    
    if next_lvl not in COMPANY_UPGRADES:
        emit('action_feedback', {'success': False, 'message': 'Sua empresa já está no nível máximo!'})
        return
        
    cost = COMPANY_UPGRADES[next_lvl]['cost']
    if player['money'] < cost:
        emit('action_feedback', {'success': False, 'message': f"Dinheiro insuficiente para expansão (R$ {cost:,.2f})."})
        return
        
    player['money'] = round(player['money'] - cost, 2)
    player['company_level'] = next_lvl
    player['reputation'] = min(100, player['reputation'] + 8)
    
    info = COMPANY_UPGRADES[next_lvl]
    emit('action_feedback', {
        'success': True,
        'message': f"🚀 Empresa expandida para {info['name']}! Capacidade: {info['capacity']} un."
    })

@socketio.on('launch_marketing')
def handle_launch_marketing(data):
    """Inicia uma campanha de marketing."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    camp_id = data.get('campaignId')
    if camp_id not in MARKETING_CAMPAIGNS:
        return
        
    player = room['players'][sid]
    camp = MARKETING_CAMPAIGNS[camp_id]
    
    if player['money'] < camp['cost']:
        emit('action_feedback', {'success': False, 'message': f"Dinheiro insuficiente para a campanha (R$ {camp['cost']})."})
        return
        
    player['money'] = round(player['money'] - camp['cost'], 2)
    player['total_expenses'] = round(player['total_expenses'] + camp['cost'], 2)
    player['total_profit'] = round(player['total_profit'] - camp['cost'], 2)
    player['reputation'] = min(100, player['reputation'] + camp['rep_boost'])
    player['active_campaign'] = camp['name']
    player['campaign_timer'] = camp['duration']
    player['campaign_demand_mult'] = camp['demand_boost']
    
    emit('action_feedback', {
        'success': True,
        'message': f"📢 Campanha '{camp['name']}' ativada! Demanda aumentada em +{int((camp['demand_boost']-1)*100)}%!"
    })

# -------------------------------------------------------------
# ROLETA BET (SISTEMA DE APOSTA VIRTUAL VALIDA NO SERVIDOR)
# -------------------------------------------------------------

@socketio.on('spin_bet')
def handle_spin_bet(data):
    """Processa a aposta virtual da roleta BET no servidor."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    if room['state'] != 'IN_GAME' or sid not in room['players']:
        return
        
    bet_amount = float(data.get('betAmount', 100))
    valid_bets = [100.0, 250.0, 500.0, 1000.0]
    
    if bet_amount not in valid_bets:
        emit('bet_error', {'message': 'Valor de aposta inválido.'})
        return
        
    player = room['players'][sid]
    
    if player['money'] < bet_amount:
        emit('bet_error', {'message': 'Saldo insuficiente para realizar esta aposta!'})
        return
        
    # Deduz a aposta
    player['money'] = round(player['money'] - bet_amount, 2)
    player['bet_stats']['bets_count'] += 1
    
    # Sorteio ponderado pelo servidor
    choices = [item['val'] for item in BET_MULTIPLIERS]
    weights = [item['weight'] for item in BET_MULTIPLIERS]
    selected_mult = random.choices(choices, weights=weights, k=1)[0]
    
    win_amount = round(bet_amount * selected_mult, 2)
    net_gain = win_amount - bet_amount
    
    if win_amount > 0:
        player['money'] = round(player['money'] + win_amount, 2)
        
    if net_gain > 0:
        player['bet_stats']['won_amount'] += net_gain
    elif net_gain < 0:
        player['bet_stats']['lost_amount'] += abs(net_gain)
        
    # Buscar label correspondente
    mult_info = next((m for m in BET_MULTIPLIERS if m['val'] == selected_mult), BET_MULTIPLIERS[0])
    
    # Enviar resultado autoritativo para o cliente executar a animação
    emit('bet_result', {
        'bet_amount': bet_amount,
        'multiplier': selected_mult,
        'multiplier_label': mult_info['label'],
        'win_amount': win_amount,
        'net_gain': net_gain,
        'final_money': player['money']
    })

# -------------------------------------------------------------
# REINICIAR SALA / DESCONEXÃO
# -------------------------------------------------------------

@socketio.on('restart_room')
def handle_restart_room():
    """Reinicia a sala para uma nova partida com os mesmos participantes."""
    sid = request.sid
    room_code = sid_to_room.get(sid)
    if not room_code or room_code not in rooms:
        return
        
    room = rooms[room_code]
    
    if room['host_sid'] != sid:
        emit('action_error', {'message': 'Apenas o anfitrião pode reiniciar a sala.'})
        return
        
    # Reset do estado da sala
    room['state'] = 'WAITING'
    room['time_remaining'] = room['duration']
    room['market'] = {
        'base_raw_price': 50.0,
        'raw_material_price': 50.0,
        'sales_multiplier': 1.0,
        'supply_multiplier': 1.0,
        'active_event': None,
        'event_timer': 0
    }
    
    # Reset do estado de cada jogador
    for psid, player in room['players'].items():
        player['money'] = 10000.0
        player['net_worth'] = 10000.0
        player['total_revenue'] = 0.0
        player['total_expenses'] = 0.0
        player['total_profit'] = 0.0
        player['total_products_sold'] = 0
        player['raw_materials'] = 25
        player['finished_products'] = 5
        player['product_price'] = 100.0
        player['reputation'] = 50
        player['company_level'] = 1
        player['employees'] = {'worker': 1, 'sales': 1, 'marketing': 0, 'dev': 0}
        player['active_campaign'] = None
        player['campaign_timer'] = 0
        player['campaign_demand_mult'] = 1.0
        player['bet_stats'] = {'bets_count': 0, 'won_amount': 0.0, 'lost_amount': 0.0}
        
    socketio.emit('room_restarted', {
        'room_code': room_code,
        'players': list(room['players'].values())
    }, room=room_code)
    
    socketio.emit('public_rooms_list', get_public_rooms_list())

@socketio.on('disconnect')
def handle_disconnect():
    """Gerencia desconexão de jogadores."""
    sid = request.sid
    room_code = sid_to_room.pop(sid, None)
    
    if not room_code or room_code not in rooms:
        return
        
    room = rooms[room_code]
    player = room['players'].pop(sid, None)
    
    if player:
        player_name = player.get('name', 'Jogador')
        socketio.emit('player_left', {
            'player_name': player_name,
            'players': list(room['players'].values()),
            'message': f"⚪ {player_name} saiu da sala."
        }, room=room_code)
        
    # Se a sala esvaziou, remove
    if len(room['players']) == 0:
        rooms.pop(room_code, None)
    else:
        # Se o host saiu, transfere o host para o próximo
        if room['host_sid'] == sid:
            new_host_sid = next(iter(room['players']))
            room['host_sid'] = new_host_sid
            room['players'][new_host_sid]['is_host'] = True
            socketio.emit('host_changed', {
                'new_host_sid': new_host_sid,
                'new_host_name': room['players'][new_host_sid]['name'],
                'players': list(room['players'].values())
            }, room=room_code)
            
    socketio.emit('public_rooms_list', get_public_rooms_list())

if __name__ == '__main__':
    print("STARTUP WARS Servidor iniciado em http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
