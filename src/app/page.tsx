'use client'
import { useState, useEffect, useRef } from 'react';
import ClientCard from './components/ClientCard';
import FilterBar, { SLAFilter } from './components/FilterBar';
import AddClientModal from './components/AddClientModal';
import { Client, TaskStatus, TaskPriority } from '@/types/types';
import { api } from '@/services/api';
import { useDarkMode, useClients } from './layout';
import { getCurrentDateForInput, getDefaultSLADate } from '@/utils/dateUtils';
import { getSLAStatus } from '@/utils/slaUtils';

export default function Home() {
  // Use contexts
  const { darkMode } = useDarkMode();
  const { clients, refreshClients, isLoading } = useClients();
  
  const [error, setError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all' | 'active'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [slaFilter, setSlaFilter] = useState<SLAFilter>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState({
    start: '',
    end: ''
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const jsonData = JSON.parse(e.target?.result as string);
          
          // Validate the JSON structure
          if (!Array.isArray(jsonData)) {
            throw new Error('Invalid JSON format. Expected an array of clients.');
          }

          let successCount = 0;
          let errorCount = 0;
          const errors: string[] = [];
          const skippedClients: string[] = [];

          console.log(`Starting import of ${jsonData.length} clients...`);

          // Import each client
          for (const clientData of jsonData) {
            try {
              // Validate required client fields
              if (!clientData.name || !clientData.company || !clientData.origin) {
                throw new Error(`Missing required fields (name, company, origin) for client: ${clientData.name || clientData.id || 'Unknown'}`);
              }

              // Generate ID if not provided
              if (!clientData.id) {
                clientData.id = `CL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              }

              // Check if client already exists
              try {
                await api.getClient(clientData.id);
                // If we get here, client exists, so skip it
                skippedClients.push(`${clientData.name} (${clientData.id}) - already exists`);
                continue;
              } catch (error) {
                // Client doesn't exist, continue with creation
              }

              // Validate tasks array
              const tasks = Array.isArray(clientData.tasks) ? clientData.tasks : [];

              // Validate and clean each task
              const validTasks = tasks.filter((task: any, index: number) => {
                if (!task.description || !task.date || !task.status || !task.priority) {
                  console.warn(`Skipping invalid task ${index + 1} for client ${clientData.name}:`, task);
                  return false;
                }
                
                // Validate status and priority values
                const validStatuses = ['pending', 'in progress', 'completed', 'awaiting client'];
                const validPriorities = ['low', 'medium', 'high'];
                
                if (!validStatuses.includes(task.status)) {
                  console.warn(`Invalid status "${task.status}" for task, setting to "pending"`);
                  task.status = 'pending';
                }
                
                if (!validPriorities.includes(task.priority)) {
                  console.warn(`Invalid priority "${task.priority}" for task, setting to "medium"`);
                  task.priority = 'medium';
                }
                
                return true;
              });

              if (validTasks.length === 0) {
                // Create a default task if no valid tasks exist
                validTasks.push({
                  date: getCurrentDateForInput(),
                  description: 'Initial task',
                  status: 'pending',
                  priority: 'medium',
                  sla_date: getDefaultSLADate()
                });
              }

              console.log(`Importing client: ${clientData.name} with ${validTasks.length} tasks`);

              // Use the createClientWithTasks API
              await api.createClientWithTasks(
                {
                  id: clientData.id,
                  name: clientData.name,
                  company: clientData.company,
                  origin: clientData.origin,
                },
                validTasks
              );

              successCount++;
              console.log(`✓ Successfully imported: ${clientData.name}`);
            } catch (error) {
              errorCount++;
              const errorMsg = `${clientData.name || clientData.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
              console.error(`✗ Failed to import client ${clientData.name || clientData.id}:`, error);
              errors.push(errorMsg);
            }
          }

          await refreshClients();
          
          // Prepare result message
          let message = '';
          if (successCount > 0) {
            message += `Successfully imported ${successCount} clients!`;
          }
          if (skippedClients.length > 0) {
            message += `\n\nSkipped ${skippedClients.length} existing clients:\n${skippedClients.slice(0, 5).join('\n')}${skippedClients.length > 5 ? `\n... and ${skippedClients.length - 5} more` : ''}`;
          }
          if (errorCount > 0) {
            message += `\n\n${errorCount} failed to import:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... and ${errors.length - 5} more` : ''}`;
          }

          alert(message || 'Import completed with no changes.');
        } catch (error) {
          console.error('Error processing JSON:', error);
          alert(error instanceof Error ? error.message : 'Failed to process JSON file');
        } finally {
          setIsImporting(false);
          // Reset the file input
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      };

      reader.onerror = () => {
        setIsImporting(false);
        alert('Error reading file');
      };

      reader.readAsText(file);
    } catch (error) {
      setIsImporting(false);
      alert('Error processing file');
    }
  };

  // Filter clients based on all filter criteria
  useEffect(() => {
    let result = [...clients];

    // Date range filter
    if (dateRangeFilter.start || dateRangeFilter.end) {
      result = result.filter(client => 
        client.tasks.some(task => {
          const taskDate = new Date(task.date);
          const startDate = dateRangeFilter.start ? new Date(dateRangeFilter.start) : null;
          const endDate = dateRangeFilter.end ? new Date(dateRangeFilter.end) : null;
          
          if (startDate && endDate) {
            return taskDate >= startDate && taskDate <= endDate;
          } else if (startDate) {
            return taskDate >= startDate;
          } else if (endDate) {
            return taskDate <= endDate;
          }
          return true;
        })
      );
    }

    // Search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter(client =>
        client.name.toLowerCase().includes(searchLower) ||
        client.company.toLowerCase().includes(searchLower) ||
        client.origin.toLowerCase().includes(searchLower) ||
        client.id.toLowerCase().includes(searchLower)
      );
    }

    // Task description filter
    if (taskFilter.trim()) {
      const taskLower = taskFilter.toLowerCase();
      result = result.filter(client =>
        client.tasks.some(task =>
          task.description.toLowerCase().includes(taskLower)
        )
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(client =>
        client.tasks.some(task => {
          if (statusFilter === 'active') {
            return task.status === 'in progress' || task.status === 'pending';
          }
          return task.status === statusFilter;
        })
      );
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      result = result.filter(client =>
        client.tasks.some(task => task.priority === priorityFilter)
      );
    }

    // SLA filter
    if (slaFilter !== 'all') {
      result = result.filter(client =>
        client.tasks.some(task => {
          const slaStatus = getSLAStatus(task);
          
          switch (slaFilter) {
            case 'overdue':
              return slaStatus === 'overdue';
            case 'due_today':
              return slaStatus === 'due_today';
            case 'due_this_week':
              return slaStatus === 'due_this_week';
            case 'on_track':
              return slaStatus === 'on_track';
            case 'no_sla':
              return slaStatus === 'no_sla';
            default:
              return true;
          }
        })
      );
    }

    setFilteredClients(result);
  }, [clients, searchTerm, taskFilter, statusFilter, priorityFilter, slaFilter, dateRangeFilter]);

  // Calculate statistics
  const totalTasks = clients.reduce((sum, client) => sum + client.tasks.length, 0);
  const completedTasks = clients.reduce((sum, client) => 
    sum + client.tasks.filter(task => task.status === 'completed').length, 0
  );
  const inProgressTasks = clients.reduce((sum, client) => 
    sum + client.tasks.filter(task => task.status === 'in progress').length, 0
  );
  const pendingTasks = clients.reduce((sum, client) => 
    sum + client.tasks.filter(task => task.status === 'pending').length, 0
  );

  const handleExportJson = async () => {
    try {
      const data = await api.getClients();
      const jsonString = JSON.stringify(data, null, 2);
      
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `task-dashboard-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting data:', error);
      alert('Failed to export data');
    }
  };

  const clearDateFilter = () => {
    setDateRangeFilter({ start: '', end: '' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}>
      <div className="container mx-auto px-4 py-8">
        {/* Simplified Header - removed Analytics button */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Task Dashboard</h1>
        </div>

        <div className="mb-6">
          <FilterBar 
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            priorityFilter={priorityFilter}
            setPriorityFilter={setPriorityFilter}
            taskFilter={taskFilter}
            setTaskFilter={setTaskFilter}
            dateRangeFilter={dateRangeFilter}
            setDateRangeFilter={setDateRangeFilter}
            darkMode={darkMode}
            slaFilter={slaFilter}
            setSlaFilter={setSlaFilter}
          />
        </div>

        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 flex space-x-2">
            <button
              onClick={() => {
                const allExpanded: Record<string, boolean> = {};
                clients.forEach(client => {
                  allExpanded[client.id] = true;
                });
                setExpandedCards(allExpanded);
              }}
              className={`px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              Open All Cards
            </button>
            <button
              onClick={() => setExpandedCards({})}
              className={`px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              Collapse All
            </button>
            {(dateRangeFilter.start || dateRangeFilter.end) && (
              <button
                onClick={clearDateFilter}
                className={`px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                Clear Date Filter
              </button>
            )}
          </div>
          <div className="flex space-x-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className={`px-4 py-2 rounded-lg transition-colors ${
                darkMode 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-green-500 hover:bg-green-600'
              } text-white disabled:opacity-50`}
            >
              {isImporting ? 'Importing...' : 'Import JSON'}
            </button>
            <button
              onClick={handleExportJson}
              className={`px-4 py-2 rounded-lg transition-colors ${
                darkMode 
                  ? 'bg-purple-600 hover:bg-purple-700' 
                  : 'bg-purple-500 hover:bg-purple-600'
              } text-white`}
            >
              Export JSON
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className={`px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
            >
              Add New Client
            </button>
          </div>
        </div>

        {/* Statistics Section */}
        <div className={`mb-8 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-white shadow'}`}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <button 
              onClick={() => {
                setStatusFilter('all');
                setPriorityFilter('all');
                setTaskFilter('');
                clearDateFilter();
              }}
              className={`p-4 rounded-lg text-left transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-blue-100 hover:bg-blue-200'}`}
            >
              <h3 className="font-semibold">Total Tasks</h3>
              <p className="text-2xl">{totalTasks}</p>
            </button>
            <button 
              onClick={() => {
                setStatusFilter('active');
                setPriorityFilter('all');
                setTaskFilter('');
              }}
              className={`p-4 rounded-lg text-left transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-orange-100 hover:bg-orange-200'}`}
            >
              <h3 className="font-semibold">Active Tasks</h3>
              <p className="text-2xl">{inProgressTasks + pendingTasks}</p>
            </button>
            <button 
              onClick={() => {
                setStatusFilter('in progress');
                setPriorityFilter('all');
                setTaskFilter('');
              }}
              className={`p-4 rounded-lg text-left transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-yellow-100 hover:bg-yellow-200'}`}
            >
              <h3 className="font-semibold">In Progress</h3>
              <p className="text-2xl">{inProgressTasks}</p>
            </button>
            <button 
              onClick={() => {
                setStatusFilter('completed');
                setPriorityFilter('all');
                setTaskFilter('');
              }}
              className={`p-4 rounded-lg text-left transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-100 hover:bg-green-200'}`}
            >
              <h3 className="font-semibold">Completed</h3>
              <p className="text-2xl">{completedTasks}</p>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClients.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              isExpanded={expandedCards[client.id] || false}
              onToggleExpand={() => setExpandedCards(prev => ({
                ...prev,
                [client.id]: !prev[client.id]
              }))}
              onUpdate={refreshClients}
              onDeleteTask={async (clientId, taskIndex) => {
                // Implement task deletion here when backend endpoint is ready
                await refreshClients();
              }}
              darkMode={darkMode}
            />
          ))}
        </div>

        {filteredClients.length === 0 && !isLoading && (
          <div className={`text-center py-12 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {clients.length === 0 ? (
              <div>
                <p className="text-xl mb-4">No clients found</p>
                <p>Add a new client to get started!</p>
              </div>
            ) : (
              <div>
                <p className="text-xl mb-4">No clients match your current filters</p>
                <p>Try adjusting your search criteria or clearing the filters.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <AddClientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddClient={async () => {
          await refreshClients();
          setIsModalOpen(false);
        }}
        darkMode={darkMode}
      />
    </div>
  );
}