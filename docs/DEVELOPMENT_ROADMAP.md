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
- [ ] Configurar Electron.
- [ ] Configurar React, TypeScript e Tailwind.
- [ ] Implementar janela principal.
- [ ] Implementar navegação lateral.
- [ ] Criar design system inicial.
- [ ] Configurar preload e IPC seguro.
- [ ] Integrar SQLite.
- [ ] Criar migração inicial.
- [ ] Implementar CRUD de automações.
- [ ] Implementar dashboard inicial.
- [ ] Implementar tela de configurações.

### Critérios de aceite
- Aplicativo abre como programa desktop.
- Usuário cria, renomeia, arquiva e exclui uma automação.
- Dados persistem após fechar e abrir o aplicativo.
- Renderer não possui acesso direto irrestrito ao Node.

## Fase 2 — Editor visual

### Tarefas
- [ ] Integrar React Flow.
- [ ] Criar canvas com zoom e pan.
- [ ] Criar biblioteca lateral de nós.
- [ ] Criar categorias de ações.
- [ ] Implementar arrastar e soltar.
- [ ] Implementar conexões.
- [ ] Criar painel de propriedades.
- [ ] Implementar nós de início e término.
- [ ] Implementar seleção, duplicação e exclusão.
- [ ] Implementar desfazer/refazer.
- [ ] Implementar salvamento e carregamento.
- [ ] Separar dados visuais da configuração executável.
- [ ] Criar esquema versionado do workflow.
- [ ] Criar validação de parâmetros e conexões.

### Critérios de aceite
- Usuário monta um fluxo simples sem escrever código.
- O fluxo é salvo e reaberto preservando nós, conexões e posições.
- Fluxos inválidos mostram erros específicos.
- Mudanças não salvas são identificadas.

## Fase 3 — Protocolo e motor mínimo

### Tarefas
- [ ] Criar processo Python empacotável.
- [ ] Implementar protocolo JSON Lines.
- [ ] Implementar inicialização e encerramento do motor.
- [ ] Implementar heartbeat/status do motor.
- [ ] Implementar registro de ações.
- [ ] Criar interpretador básico no Node.
- [ ] Criar contexto isolado por execução.
- [ ] Implementar eventos de início, progresso e conclusão.
- [ ] Implementar timeout.
- [ ] Implementar cancelamento cooperativo.
- [ ] Implementar tratamento de falha de comunicação.
- [ ] Criar testes de integração Node/Python.

### Critérios de aceite
- Aplicativo inicia o motor e identifica sua disponibilidade.
- Um fluxo mínimo é enviado e executado.
- Eventos aparecem na interface.
- Falha do motor não encerra o aplicativo.
- Logs de protocolo não são misturados com stdout de diagnóstico.

## Fase 4 — Biblioteca essencial de ações

### Tarefas
- [ ] Implementar esperar.
- [ ] Implementar definir variável.
- [ ] Implementar comparação e condição.
- [ ] Implementar repetição N vezes.
- [ ] Implementar listar arquivos.
- [ ] Implementar verificar existência.
- [ ] Implementar criar pasta.
- [ ] Implementar copiar e mover arquivos.
- [ ] Implementar renomear arquivo.
- [ ] Implementar abrir aplicativo.
- [ ] Implementar localizar e ativar janela.
- [ ] Implementar digitar texto.
- [ ] Implementar clique e teclas.
- [ ] Implementar resultado estruturado por ação.
- [ ] Criar exemplos prontos.

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

## Fase 6 — Importação, exportação e agendamento

### Tarefas
- [ ] Exportar workflow JSON.
- [ ] Importar com validação.
- [ ] Mostrar resumo do conteúdo importado.
- [ ] Rejeitar schemas desconhecidos ou inválidos.
- [ ] Criar agendamento único.
- [ ] Criar agendamento diário e semanal.
- [ ] Integrar com Agendador de Tarefas do Windows.
- [ ] Exibir próxima execução e última execução.
- [ ] Tratar computador desligado ou usuário desconectado.
- [ ] Documentar limitações de sessão interativa.

### Critérios de aceite
- Fluxo exportado pode ser importado em outra instalação compatível.
- Importação nunca inicia execução automaticamente.
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
- Importação e exportação.

### Importante, mas posterior
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
