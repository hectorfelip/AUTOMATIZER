# Automation Studio — Roadmap de Desenvolvimento

**Versão:** 1.0  
**Objetivo:** entregar primeiro um MVP confiável e evoluir por incrementos verificáveis.

## 1. Estratégia

Desenvolver em entregas verticais. Cada fase deve terminar com algo executável e testável. Não começar por IA, OCR ou gravador avançado: o primeiro objetivo é provar o ciclo completo de criação visual → validação → execução → log.

## 2. Fases

## Fase 0 — Preparação técnica

### Tarefas
- [ ] Criar repositório Git.
- [ ] Definir convenções de código e branches.
- [ ] Configurar monorepo ou estrutura de workspaces.
- [ ] Configurar TypeScript e lint.
- [ ] Configurar testes automatizados.
- [ ] Criar documentação de decisões arquiteturais.
- [ ] Definir padrão de commits e versionamento.

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
- [ ] Implementar abrir aplicativo. *(implementado e testado com dublês; falta validar no Windows: `scripts/verify-actions.py`)*
- [ ] Implementar localizar e ativar janela. *(implementado e testado com dublês; falta validar no Windows: `scripts/verify-actions.py`)*
- [ ] Implementar digitar texto. *(implementado e testado com dublês; falta validar no Windows: `scripts/verify-actions.py`)*
- [ ] Implementar clique e teclas. *(implementado e testado com dublês; falta validar no Windows: `scripts/verify-actions.py`)*
- [x] Implementar resultado estruturado por ação.
- [x] Criar exemplos prontos.

### Critérios de aceite
- Usuário consegue criar uma automação útil de organização de arquivos.
- Usuário consegue abrir um aplicativo e executar uma sequência simples de teclado/mouse.
- Condições e repetições funcionam.
- Ações retornam resultados e erros compreensíveis.

## Fase 5 — Execução, depuração e histórico

### Tarefas
- [ ] Criar painel de execução.
- [ ] Exibir nó atual.
- [ ] Exibir estado de cada nó.
- [ ] Implementar iniciar, pausar, continuar e cancelar quando suportado.
- [ ] Implementar execução passo a passo.
- [ ] Implementar execução a partir de nó selecionado, com contexto definido.
- [ ] Implementar breakpoints.
- [ ] Implementar visualização de variáveis.
- [ ] Persistir histórico.
- [ ] Persistir logs.
- [ ] Criar filtros e detalhes de execução.
- [ ] Implementar política de erro (parar, continuar em caminhos permitidos).
- [ ] Criar captura de diagnóstico opcional.

### Critérios de aceite
- Usuário identifica qual nó está executando.
- Falhas apontam o nó e a causa.
- Histórico continua disponível após reiniciar o aplicativo.
- Cancelamento não deixa o motor em estado inconsistente.

## Fase 6a — Importação e exportação (MVP)

### Tarefas
- [ ] Exportar workflow JSON.
- [ ] Importar com validação.
- [ ] Mostrar resumo do conteúdo importado.
- [ ] Rejeitar schemas desconhecidos ou inválidos.

### Critérios de aceite
- Fluxo exportado pode ser importado em outra instalação compatível.
- Importação nunca inicia execução automaticamente.

## Fase 6b — Agendamento (pós-MVP)

Só inicia após a Fase 6a aceita; não bloqueia o MVP.

### Tarefas
- [ ] Criar agendamento único.
- [ ] Criar agendamento diário e semanal.
- [ ] Integrar com Agendador de Tarefas do Windows.
- [ ] Exibir próxima execução e última execução.
- [ ] Tratar computador desligado ou usuário desconectado.
- [ ] Documentar limitações de sessão interativa.

### Critérios de aceite
- Agendamentos são visíveis, editáveis e podem ser desativados.

## Fase 7 — Gravador e automação web

### Tarefas
- [ ] Prototipar captura de mouse e teclado.
- [ ] Implementar indicador visual de gravação.
- [ ] Implementar pausa e parada.
- [ ] Converter gravação em nós editáveis.
- [ ] Excluir ou mascarar campos sensíveis.
- [ ] Integrar Playwright.
- [ ] Criar nós para navegação, clique, preenchimento e extração.
- [ ] Implementar espera por elementos.
- [ ] Criar testes em páginas de demonstração.

### Critérios de aceite
- Gravação pode ser revisada antes de virar fluxo.
- Usuário consegue corrigir ações geradas.
- Automação web usa seletores/elementos sempre que possível, não coordenadas de tela.

## Fase 8 — Reconhecimento visual e extensibilidade

### Tarefas
- [ ] Prototipar OCR.
- [ ] Implementar localizar texto na tela.
- [ ] Implementar localizar imagem de referência.
- [ ] Implementar espera por elemento visual.
- [ ] Definir API de plugins de ações.
- [ ] Documentar criação de novos nós.
- [ ] Criar subfluxos reutilizáveis.
- [ ] Criar biblioteca de templates.

### Critérios de aceite
- Ações visuais têm timeout e limiar de confiança configuráveis.
- Plugins são validados e carregados de forma controlada.
- Subfluxos podem receber parâmetros e devolver resultados.

## Fase 9 — Qualidade e distribuição

### Tarefas
- [ ] Testar instalação em Windows limpo.
- [ ] Testar diferentes escalas de DPI.
- [ ] Testar múltiplas resoluções.
- [ ] Testar caminhos com acentos e espaços.
- [ ] Testar permissões e aplicativos elevados.
- [ ] Revisar segurança do IPC.
- [ ] Revisar armazenamento de segredos.
- [ ] Otimizar uso de memória.
- [ ] Criar instalador.
- [ ] Criar desinstalador e política de preservação de dados.
- [ ] Criar documentação de usuário.
- [ ] Criar notas de versão.

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
