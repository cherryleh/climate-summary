import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

type StormMode = 'daily' | 'cumulative';

interface StormDay {
  label: string;
  date: string;
  stats: {
    daily: {
      total: string;
      max: string;
      avg: string;
      wettest: string;
    };
    cumulative: {
      total: string;
      max: string;
      avg: string;
      wettest: string;
    };
  };
}
@Component({
  selector: 'app-storm-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './storm-viewer.component.html',
  styleUrl: './storm-viewer.component.css'
})
export class StormViewerComponent {
  mode: StormMode = 'daily';
  selectedDayIndex = 0;

  days: StormDay[] = [
    {
      label: 'Day 1',
      date: '2026_03_10',
      stats: {
        daily: { total:'2.4 in', max:'5.8 in', avg:'1.2 in', wettest:'Kauaʻi' },
        cumulative: { total:'2.4 in', max:'5.8 in', avg:'1.2 in', wettest:'Kauaʻi' }
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_11',
      stats: {
        daily: { total:'1.8 in', max:'4.3 in', avg:'0.9 in', wettest:'Maui' },
        cumulative: { total:'4.2 in', max:'7.1 in', avg:'2.1 in', wettest:'Kauaʻi' }
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_12',
      stats: {
        daily: { total:'3.1 in', max:'6.2 in', avg:'1.6 in', wettest:'Oʻahu' },
        cumulative: { total:'7.3 in', max:'9.4 in', avg:'3.2 in', wettest:'Oʻahu' }
      }
    },
    {
      label: 'Day 4',
      date: '2026_03_13',
      stats: {
        daily: { total:'0.7 in', max:'1.9 in', avg:'0.3 in', wettest:'Hawaiʻi' },
        cumulative: { total:'8.0 in', max:'10.2 in', avg:'3.5 in', wettest:'Oʻahu' }
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_14',
      stats: {
        daily: { total:'4.0 in', max:'7.4 in', avg:'2.0 in', wettest:'Kauaʻi' },
        cumulative: { total:'12.0 in', max:'14.8 in', avg:'5.4 in', wettest:'Kauaʻi' }
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_15',
      stats: {
        daily: { total:'2.0 in', max:'3.8 in', avg:'1.1 in', wettest:'Molokaʻi' },
        cumulative: { total:'14.0 in', max:'16.1 in', avg:'6.1 in', wettest:'Kauaʻi' }
      }
    }
  ];

  get selectedDay(){
    return this.days[this.selectedDayIndex];
  }

  get imagePath(){
    const base = `${this.selectedDay.date}`;
    return this.mode === 'daily'
      ? `storm_site/${base}.png`
      : `storm_site/${base}_cumulative.png`;
  }

  get stats(){
    return this.selectedDay.stats[this.mode];
  }

  selectDay(i:number){
    this.selectedDayIndex = i;
  }

  toggleMode(){
    this.mode = this.mode === 'daily' ? 'cumulative' : 'daily';
  }

}
