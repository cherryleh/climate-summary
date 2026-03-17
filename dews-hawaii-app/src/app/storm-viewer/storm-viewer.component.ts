import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';

type StormMode = 'daily' | 'cumulative';

interface StormDay {
  label: string;
  date: string;
  stats: {
    daily: {
      date: string;
      avg: string;
    };
    cumulative: {
      date: string;
      avg: string;
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
export class StormViewerComponent implements OnDestroy {
  mode: StormMode = 'daily';
  selectedDayIndex = 0;

  isPlaying = false;
  playbackMs = 1200;
  private playInterval: ReturnType<typeof setInterval> | null = null;


  days: StormDay[] = [
    {
      label: 'Day 1',
      date: '2026_03_10',
      stats: {
        daily: { date: 'March 10, 2026', avg:'1.2 in' },
        cumulative: { date: 'March 10, 2026', avg:'1.2 in' }
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_11',
      stats: {
        daily: { date: 'March 11, 2026', avg:'0.9 in' },
        cumulative: { date: 'March 11, 2026', avg:'2.1 in' }
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_12',
      stats: {
        daily: { date: 'March 12, 2026', avg:'1.6 in' },
        cumulative: { date: 'March 12, 2026', avg:'3.2 in' }
      }
    },
    {
      label: 'Day 4',
      date: '2026_03_13',
      stats: {
        daily: { date: 'March 13, 2026', avg:'0.3 in' },
        cumulative: { date: 'March 13, 2026', avg:'3.5 in' }
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_14',
      stats: {
        daily: { date: 'March 14, 2026', avg:'2.0 in' },
        cumulative: { date: 'March 14, 2026', avg:'5.4 in' }
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_15',
      stats: {
        daily: { date: 'March 15, 2026', avg:'1.1 in' },
        cumulative: { date: 'March 15, 2026', avg:'6.1 in' }
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
  togglePlay() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  startPlayback() {
    if (this.playInterval) return;

    this.isPlaying = true;
    this.playInterval = setInterval(() => {
      this.selectedDayIndex = (this.selectedDayIndex + 1) % this.days.length;
    }, this.playbackMs);
  }

  stopPlayback() {
    this.isPlaying = false;

    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  ngOnDestroy() {
    this.stopPlayback();
  }
}
