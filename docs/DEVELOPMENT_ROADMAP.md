# Automation Studio — Roadmap de Desenvolvimento

**Versão:** 1.0  
**Objetivo:** entregar primeiro um MVP confiável e evoluir por incrementos verificáveis.

## 1. Estratégia

Desenvolver em entregas verticais. Cada fase deve terminar com algo executável e testável. Não começar por IA, OCR ou gravador avançado: o primeiro objetivo é provar o ciclo completo de criação visual → validação → execução → log.

## 2. Fases

## Fase 0 — Preparação técnica

### Tarefas
- [x] Criar repositório Git.
- [x] Definir convenções de código e branches. *(`docs/CONVENTIONS.md`)*
- [x] Configurar monorepo ou estrutura de workspaces. *(npm workspaces: `apps/*`, `packages/*`; ADR 0002)*
- [x] Configurar TypeScript e lint. *(`npm run typecheck`, `npm run lint`)*
- [x] Configurar testes automatizados. *(Vitest, pytest e Playwright/Electron)*
- [x] Criar documentação de decisões arquiteturais. *(`docs/adr/`, 16 ADRs)*
- [x] Definir padrão de commits e versionamento. *(Conventional Commits + SemVer 0.x; `docs/CONVENTIONS.md`)*

### Critérios de aceite
- Projeto instala dependências sem erros.
- Build mínimo executa localmente.
- Testes e lint rodam por comando documentado.

## Fase 1 — Shell desktop e persistência

### Tarefas
- [x] Configurar Electron.
- [x] Configurar React, TypeScript e Tailwind.
- [x] Implementar janela principal.
- [x] Implementar navegação lateral.
- [x] Criar design system inicial.
- [x] Configurar preload e IPC seguro.
- [x] Integrar SQLite.
- [x] Criar migração inicial.
- [x] Implementar CRUD de automações.
- [x] Implementar dashboard inicial.
- [x] Implementar tela de configurações.

### Critérios de aceite
- Aplicativo abre como programa desktop.
- Usuário cria, renomeia, arquiva e exclui uma automação.
- Dados persistem após fechar e abrir o aplicativo.
- Renderer não possui acesso direto irrestrito ao Node.

## Fase 2 — Editor visual

### Tarefas
- [x] Integrar React Flow.
- [x] Criar canvas com zoom e pan.
- [x] Criar biblioteca lateral de nós.
- [x] Criar categorias de ações.
- [x] Implementar arrastar e soltar.
- [x] Implementar conexões.
- [x] Criar painel de propriedades.
- [x] Implementar nós de início e término.
- [x] Implementar seleção, duplicação e exclusão.
- [x] Implementar desfazer/refazer.
- [x] Implementar salvamento e carregamento.
- [x] Separar dados visuais da configuração executável.
- [x] Criar esquema versionado do workflow.
- [x] Criar validação de parâmetros e conexões.

### Critérios de aceite
- Usuário monta um fluxo simples sem escrever código.
- O fluxo é salvo e reaberto preservando nós, conexões e posições.
- Fluxos inválidos mostram erros específicos.
- Mudanças não salvas são identificadas.

## Fase 3 — Protocolo e motor mínimo

### Tarefas
- [x] Criar processo Python empacotável.
- [x] Spike de empacotamento: gerar o motor como executável (ex.: PyInstaller) com pywinauto/PyAutoGUI e iniciá-lo pelo Electron em Windows real, para descobrir incompatibilidades antes da Fase 9. *(Windows: executável + pywinauto/pyautogui validados; Electron iniciando o .exe ainda não exercitado no Windows)*
- [x] Implementar protocolo JSON Lines.
- [x] Implementar inicialização e encerramento do motor.
- [x] Implementar heartbeat/status do motor.
- [x] Implementar registro de ações.
- [x] Criar interpretador básico no Node.
- [x] Criar contexto isolado por execução.
- [x] Implementar eventos de início, progresso e conclusão.
- [x] Implementar timeout.
- [x] Implementar cancelamento cooperativo.
- [x] Implementar tratamento de falha de comunicação.
- [x] Criar testes de integração Node/Python.

### Critérios de aceite
- Aplicativo inicia o motor e identifica sua disponibilidade.
- Um fluxo mínimo é enviado e executado.
- Eventos aparecem na interface.
- Falha do motor não encerra o aplicativo.
- Logs de protocolo não são misturados com stdout de diagnóstico.
- Motor empacotado inicia e responde ao heartbeat em Windows sem Python global instalado (validado pelo Hector em máquina real).

## Fase 4 — Biblioteca essencial de ações

### Tarefas
- [x] Implementar esperar.
- [x] Implementar definir variável.
- [x] Implementar comparação e condição.
- [x] Implementar repetição N vezes.
- [x] Implementar listar arquivos.
- [x] Implementar verificar existência.
- [x] Implementar criar pasta.
- [x] Implementar copiar e mover arquivos.
- [x] Implementar renomear arquivo.
- [x] Implementar abrir aplicativo. *(validado no Windows real: `scripts/verify-actions.py` passou)*
- [x] Implementar localizar e ativar janela. *(validado no Windows real: `scripts/verify-actions.py` passou)*
- [x] Implementar digitar texto. *(validado no Windows real: `scripts/verify-actions.py` passou)*
- [x] Implementar clique e teclas. *(validado no Windows real: `scripts/verify-actions.py` passou)*
- [x] Implementar resultado estruturado por ação.
- [x] Implementar “Para cada item” e resultado dos nós nas expressões *(acrescentado por decisão do Hector; ADR 0008)*.
- [x] Criar exemplos prontos.

### Critérios de aceite
- Usuário consegue criar uma automação útil de organização de arquivos.
- Usuário consegue abrir um aplicativo e executar uma sequência simples de teclado/mouse.
- Condições e repetições funcionam.
- Ações retornam resultados e erros compreensíveis.

## Fase 5 — Execução, depuração e histórico

### Tarefas
- [x] Criar painel de execução.
- [x] Exibir nó atual.
- [x] Exibir estado de cada nó.
- [x] Implementar iniciar, pausar, continuar e cancelar quando suportado.
- [x] Implementar execução passo a passo.
- [x] Implementar execução a partir de nó selecionado, com contexto definido.
- [x] Implementar breakpoints.
- [x] Implementar visualização de variáveis.
- [x] Persistir histórico.
- [x] Persistir logs.
- [x] Criar filtros e detalhes de execução.
- [x] Implementar política de erro (parar, continuar em caminhos permitidos).
- [x] Criar captura de diagnóstico opcional. *(implementada; captura real de tela **não verificada no Windows**)*

### Critérios de aceite
- Usuário identifica qual nó está executando.
- Falhas apontam o nó e a causa.
- Histórico continua disponível após reiniciar o aplicativo.
- Cancelamento não deixa o motor em estado inconsistente.

## Fase 6a — Importação e exportação (MVP)

### Tarefas
- [x] Exportar workflow JSON.
- [x] Importar com validação.
- [x] Mostrar resumo do conteúdo importado.
- [x] Rejeitar schemas desconhecidos ou inválidos.

### Critérios de aceite
- Fluxo exportado pode ser importado em outra instalação compatível.
- Importação nunca inicia execução automaticamente.

## Fase 6b — Agendamento (pós-MVP)

Só inicia após a Fase 6a aceita; não bloqueia o MVP.

### Tarefas
- [x] Criar agendamento único.
- [x] Criar agendamento diário e semanal.
- [x] Integrar com Agendador de Tarefas do Windows. *(implementado e testado com dublê; **não verificado em Windows**)*
- [x] Exibir próxima execução e última execução.
- [x] Tratar computador desligado ou usuário desconectado. *(configurado no XML da tarefa; **não verificado em Windows**)*
- [x] Documentar limitações de sessão interativa.

### Critérios de aceite
- Agendamentos são visíveis, editáveis e podem ser desativados.

## Fase 7 — Gravador e automação web

### Tarefas
- [x] Prototipar captura de mouse e teclado. *(spike validado no Windows (49 eventos))*
- [x] Implementar indicador visual de gravação. *(faixa sempre visível; **não verificada no Windows**)*
- [x] Implementar pausa e parada. *(atalhos globais + botões; **atalhos não verificados no Windows**)*
- [x] Converter gravação em nós editáveis. *(revisão com edição/remoção/reordenação)*
- [x] Excluir ou mascarar campos sensíveis. *(modo senha: o caractere nunca sai do processo; testado)*
- [x] Integrar Playwright. *(motor; **empacotamento e Edge/Chrome no Windows não verificados**)*
- [x] Criar nós para navegação, clique, preenchimento e extração.
- [x] Implementar espera por elementos.
- [x] Criar testes em páginas de demonstração.

> Gravador: **implementado** (ADR 0016); **no Windows o Hector rodou o app com o motor congelado e o gravador ("tudo certo", 19/11, sem detalhar item a item)**; faixa vermelha, minimizar/restaurar e Ctrl+Alt+P/S não foram confirmados individualmente. Sem clique por elemento UIA.

### Critérios de aceite
- Gravação pode ser revisada antes de virar fluxo.
- Usuário consegue corrigir ações geradas.
- Automação web usa seletores/elementos sempre que possível, não coordenadas de tela.

## Fase 8 — Reconhecimento visual e extensibilidade

### Tarefas
- [x] Prototipar OCR. *(spike no Windows do Hector: pt-BR, 0,42 s, 385 palavras — ADR 0015)*
- [x] Implementar localizar texto na tela. *(`vision.find_text`; **validada no Windows** pelo Hector: "Lixeira" achada, similaridade 0,933, 1,05 s)*
- [x] Implementar localizar imagem de referência. *(`vision.find_image`, Pillow puro — decisão do Hector; testada em Linux com tela falsa; **falta rodar no Windows**: `python scripts\verify-vision.py --image caminho.png`)*
- [x] Implementar espera por elemento visual. *(`vision.find_text` e `vision.find_image` esperam aparecer, com timeout)*
- [x] Definir API de plugins de ações. *(declarativa, sem código — ADR 0014 opção A; opção B não feita)*
- [x] Documentar criação de novos nós. *(`docs/PLUGINS.md`)*
- [x] Criar subfluxos reutilizáveis. *(ADR 0013)*
- [x] Criar biblioteca de templates. *(7 exemplos embutidos; "formato final do pacote" segue aberto — ARCHITECTURE §15)*

> **Pendentes:** `vision.find_image` **em espera por decisão do Hector** (testou com um arquivo exibido a 69% do tamanho e deu 0,0 — o casamento é por pixels, na mesma escala; opção "tolerar tamanhos diferentes" proposta e não decidida); `vision.find_text` e UIA **validados no Windows** (Hector, `verify-vision.py "Lixeira"` → similaridade 0,933 em 1,05 s). Critério "ações visuais com timeout e limiar configuráveis": **atendido** para texto e imagem (imagem só testada em Linux). "Plugins validados e carregados de forma controlada": **atendido** para plugins declarativos.

### Critérios de aceite
- Ações visuais têm timeout e limiar de confiança configuráveis.
- Plugins são validados e carregados de forma controlada.
- Subfluxos podem receber parâmetros e devolver resultados.

## Fase 9 — Qualidade e distribuição

### Tarefas
- [ ] Testar instalação em Windows limpo.
- [ ] Testar diferentes escalas de DPI.
- [ ] Testar múltiplas resoluções.
- [x] Testar caminhos com acentos e espaços. *(ações de arquivo no Windows real, por Hector — `verify-actions.py` 11/11)*
- [ ] Testar permissões e aplicativos elevados.
- [x] Revisar segurança do IPC.
- [x] Revisar armazenamento de segredos. *(nenhum segredo armazenado hoje)*
- [ ] Otimizar uso de memória. *(só medido: ~493 MB em repouso no Linux; sem otimização)*
- [ ] Criar instalador. *(configurado — `docs/INSTALLER.md`; pacote validado em Linux; **build NSIS não executado**)*
- [ ] Criar desinstalador e política de preservação de dados. *(política definida e configurada; **não verificada no Windows**)*
- [x] Criar documentação de usuário.
- [x] Criar notas de versão.

### Critérios de aceite
- Instalador funciona em máquina de teste.
- Aplicativo pode ser atualizado sem corromper banco.
- Erros comuns possuem mensagens úteis.
- Documentação explica instalação, execução e limitações.

## 3. Priorização do MVP

### Obrigatório
- Dashboard.
- CRUD de automações.
- Editor visual.
- Persistência de workflows.
- Validador.
- Motor Python.
- Protocolo Node/Python.
- Mouse e teclado básicos.
- Arquivos e pastas.
- Abrir aplicativo e localizar janela.
- Variáveis, condições e repetição.
- Logs e histórico.
- Cancelamento.
- Importação e exportação (Fase 6a).

### Importante, mas posterior
- Agendamento (Fase 6b).
- Gravador.
- Automação web.
- OCR.
- Reconhecimento por imagem.
- Agendador avançado.
- Subfluxos.
- Plugins externos.
- IA para gerar fluxos.

## 4. Plano de testes

### Testes unitários
- Validação de schemas.
- Resolução de variáveis.
- Avaliação de condições.
- Controle de loops.
- Mapeamento de erros.
- Migrações do banco.

### Testes de integração
- Electron Main ↔ Renderer.
- Node ↔ Python.
- Interpretador ↔ registro de ações.
- Execução ↔ persistência de logs.
- Importação/exportação.

### Testes end-to-end
- Criar fluxo.
- Conectar nós.
- Configurar propriedades.
- Salvar e reabrir.
- Executar fluxo.
- Ver logs.
- Cancelar fluxo.
- Importar e exportar.

### Casos de falha
- Motor Python ausente ou encerrado.
- Arquivo inexistente.
- Pasta sem permissão.
- Aplicativo não encontrado.
- Janela não localizada.
- Timeout.
- Loop sem saída.
- JSON inválido.
- Banco indisponível.
- Aplicativo fechado durante execução.

## 5. Definição de pronto (Definition of Done)

Uma funcionalidade só será considerada concluída quando:
- Código estiver integrado e revisado.
- Validações de entrada estiverem implementadas.
- Estados de sucesso, erro e cancelamento estiverem definidos.
- Logs úteis estiverem disponíveis.
- Testes relevantes estiverem passando.
- Interface apresentar feedback claro.
- Documentação mínima estiver atualizada.
- Não houver regressão nos fluxos existentes.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Coordenadas de tela frágeis | Preferir UI Automation e seletores |
| Aplicativos elevados | Documentar limites e testar permissões |
| Travamento do motor | Processo separado e watchdog |
| Fluxos com loops infinitos | Limites, timeout e cancelamento |
| Importação maliciosa | Validar schema e não executar automaticamente |
| Mudanças no Windows | Abstrair adaptadores e testar versões |
| Dependências Python | Fixar versões e empacotar runtime |
| Perda de dados | Migrações, backups e gravação transacional |

## 7. Sequência recomendada de entregas demonstráveis

1. **Protótipo visual:** dashboard e canvas navegáveis, ainda sem automação real.
2. **Primeiro fluxo real:** iniciar → listar arquivos → mover arquivo.
3. **Controle de fluxo:** condição, repetição e variáveis.
4. **Automação desktop:** abrir aplicativo, localizar janela e digitar.
5. **Operação confiável:** logs, histórico, cancelamento e recuperação.
6. **Distribuição:** instalador Windows e documentação.

## 8. Regra de escopo

Não iniciar uma nova fase enquanto os critérios de aceite da fase anterior não forem demonstrados. Recursos avançados não devem comprometer a estabilidade do editor, do interpretador ou do motor de execução.
